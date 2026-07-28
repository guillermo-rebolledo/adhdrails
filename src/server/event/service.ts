import { z } from "zod";

import { isRecurringEvent } from "@/domain/calendar/export";
import {
  decodeEventCursor,
  LATER_PAGE_SIZE,
  paginate,
} from "@/domain/calendar/later";
import {
  eventCreateRequestSchema,
  eventUpdateRequestSchema,
  resolveCreate,
  resolveUpdate,
} from "@/domain/event/event";

import type {
  EventExportSpec,
  EventRecord,
  EventRepository,
} from "./repository";

export type EventCreateResult =
  | { ok: true; item: EventRecord; created: boolean }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "conflict"; current: EventRecord }
  | { ok: false; reason: "gone" };

export type EventUpdateResult =
  | { ok: true; item: EventRecord; applied: boolean }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "conflict"; current: EventRecord }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "gone" }
  | { ok: false; reason: "recurring_series" };

/**
 * Resolves the account's single writable Google calendar, if it has one. Injected
 * so the Event service can decide whether a local Event mutation should be
 * exported to Google without depending on the Calendar repository directly. When
 * absent (or resolving to null) the account has no write destination and local
 * Events simply stay local until an explicit export-on-reconnect.
 */
export interface WritableCalendarLookup {
  get(userId: string): Promise<{ googleCalendarId: string } | null>;
}

export interface EventServiceDependencies {
  writableCalendar?: WritableCalendarLookup;
}

/** A resolved page of the Later list plus the opaque cursor for the next page. */
export interface LaterPage {
  items: EventRecord[];
  nextCursor: string | null;
}

function toCreateState(record: EventRecord) {
  return {
    title: record.title,
    startAt: record.startAt.toISOString(),
    endAt: record.endAt.toISOString(),
    startTimeZone: record.startTimeZone,
    endTimeZone: record.endTimeZone,
    idempotencyKey: record.idempotencyKey,
  };
}

/**
 * Owns the Event use cases: validate a mutation, resolve it against the stored
 * world (including deletion tombstones), and report a domain-level outcome.
 * Idempotent retries return the stored record; a stale base version returns a
 * conflict so the client's local change is retained for review. Reads expose the
 * weekly window and the cursor-paged Later list. Route handlers translate the
 * outcome to HTTP.
 */
export function createEventService(
  repository: EventRepository,
  deps: EventServiceDependencies = {},
) {
  /** The write target for a mutation to an already mirrored Event, if any. */
  function linkedTarget(record: EventRecord): EventExportSpec | undefined {
    return record.googleCalendarId && record.googleEventId
      ? { googleCalendarId: record.googleCalendarId }
      : undefined;
  }

  /** The account's writable calendar as an export target, or undefined. */
  async function writableTarget(
    userId: string,
  ): Promise<EventExportSpec | undefined> {
    const writable = await deps.writableCalendar?.get(userId);
    return writable
      ? { googleCalendarId: writable.googleCalendarId }
      : undefined;
  }

  return {
    async create(
      userId: string,
      rawInput: unknown,
    ): Promise<EventCreateResult> {
      const parsed = eventCreateRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }

      const input = parsed.data;
      const tombstoned = await repository.isTombstoned(userId, input.id);
      const existing = await repository.getById(userId, input.id);
      const resolution = resolveCreate(
        existing ? toCreateState(existing) : null,
        input,
        tombstoned,
      );

      if (resolution === "gone") {
        return { ok: false, reason: "gone" };
      }
      if (resolution === "conflict") {
        return { ok: false, reason: "conflict", current: existing! };
      }
      if (resolution === "replay") {
        return { ok: true, item: existing!, created: false };
      }

      // A new local timed Event exports to the writable calendar when one is
      // selected; otherwise it stays local until an explicit export-on-reconnect.
      const target = await writableTarget(userId);
      const item = target
        ? await repository.insert(userId, input, target)
        : await repository.insert(userId, input);
      return { ok: true, item, created: true };
    },

    async update(
      userId: string,
      id: string,
      rawInput: unknown,
    ): Promise<EventUpdateResult> {
      const parsed = eventUpdateRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }

      const input = parsed.data;
      const tombstoned = await repository.isTombstoned(userId, id);
      const existing = await repository.getById(userId, id);
      const resolution = resolveUpdate(existing, input, tombstoned);

      if (resolution === "gone") {
        return { ok: false, reason: "gone" };
      }
      if (resolution === "missing") {
        return { ok: false, reason: "not_found" };
      }
      if (resolution === "conflict") {
        return { ok: false, reason: "conflict", current: existing! };
      }

      // Recurring-series edits route the user to Google rather than being
      // partially applied in Rails. This precedes the replay short-circuit so a
      // re-sent recurring edit is refused consistently, never silently accepted.
      if (existing && isRecurringEvent(existing)) {
        return { ok: false, reason: "recurring_series" };
      }

      if (resolution === "replay") {
        return { ok: true, item: existing!, applied: false };
      }

      // Propagate to Google when the Event is already mirrored there, or when it
      // is a local Event and a writable calendar is selected.
      const exportSpec =
        linkedTarget(existing!) ?? (await writableTarget(userId));
      const write = {
        patch: input.patch,
        version: existing!.version + 1,
        idempotencyKey: input.idempotencyKey,
      };

      const item = exportSpec
        ? await repository.update(userId, id, write, exportSpec)
        : await repository.update(userId, id, write);
      return { ok: true, item, applied: true };
    },

    /** Deletes an Event and writes its tombstone. Idempotent by construction. */
    async remove(userId: string, id: string): Promise<void> {
      await repository.remove(userId, id);
    },

    /** Events starting in the half-open window `[from, to)`, ordered by start. */
    listInWindow(userId: string, from: Date, to: Date): Promise<EventRecord[]> {
      return repository.listInWindow(userId, from, to);
    },

    /**
     * One page of the Later list — Events starting on or after `from`, resumed
     * after `rawCursor`. A malformed cursor degrades to the first page. Fetches
     * one extra row to decide whether a next cursor exists.
     */
    async listLater(
      userId: string,
      from: Date,
      rawCursor: string | null = null,
      pageSize: number = LATER_PAGE_SIZE,
    ): Promise<LaterPage> {
      const cursor = rawCursor ? decodeEventCursor(rawCursor) : null;
      // Fetch one extra row so `paginate` can tell whether more remain.
      const rows = await repository.listLater(userId, {
        from,
        cursor,
        limit: pageSize + 1,
      });

      return paginate(rows, pageSize, (row) => ({
        startAt: row.startAt.toISOString(),
        id: row.id,
      }));
    },
  };
}

export type EventService = ReturnType<typeof createEventService>;
