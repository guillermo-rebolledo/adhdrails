import { z } from "zod";

import {
  decodeEventCursor,
  encodeEventCursor,
  LATER_PAGE_SIZE,
} from "@/domain/calendar/later";
import {
  eventCreateRequestSchema,
  eventUpdateRequestSchema,
  resolveCreate,
  resolveUpdate,
} from "@/domain/event/event";

import type { EventRecord, EventRepository } from "./repository";

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
  | { ok: false; reason: "gone" };

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
export function createEventService(repository: EventRepository) {
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

      const item = await repository.insert(userId, input);
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
      if (resolution === "replay") {
        return { ok: true, item: existing!, applied: false };
      }

      const item = await repository.update(userId, id, {
        patch: input.patch,
        version: existing!.version + 1,
        idempotencyKey: input.idempotencyKey,
      });
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
      const rows = await repository.listLater(userId, {
        from,
        cursor,
        limit: pageSize + 1,
      });

      if (rows.length <= pageSize) {
        return { items: rows, nextCursor: null };
      }

      const items = rows.slice(0, pageSize);
      const last = items[items.length - 1];
      return {
        items,
        nextCursor: encodeEventCursor({
          startAt: last.startAt.toISOString(),
          id: last.id,
        }),
      };
    },
  };
}

export type EventService = ReturnType<typeof createEventService>;
