import { and, asc, eq, gt, gte, isNull, lt, or } from "drizzle-orm";

import { isRecurringEvent } from "@/domain/calendar/export";
import type { MirrorEvent } from "@/domain/calendar/import";
import type { EventCreateRequest, EventPatch } from "@/domain/event/event";
import type { EventCursor } from "@/domain/calendar/later";
import type { Database } from "@/server/db/connection";
import { event, eventTombstone } from "@/server/db/schema";

import { enqueueExportJob } from "./export-job-repository";

export interface EventRecord {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  startTimeZone: string;
  endTimeZone: string;
  isAllDay: boolean;
  allDayStartDate: string | null;
  allDayEndDate: string | null;
  recurringEventId: string | null;
  recurrence: string[] | null;
  status: string;
  origin: string;
  googleCalendarId: string | null;
  googleEventId: string | null;
  version: number;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The write target for an Event mutation that should propagate to Google. The
 * service supplies it only when an export is warranted (a local Event with a
 * writable calendar, or an edit to an already mirrored Event); the repository
 * then enqueues the outbox job atomically with the mutation.
 */
export interface EventExportSpec {
  googleCalendarId: string;
}

const recordColumns = {
  id: event.id,
  title: event.title,
  startAt: event.startAt,
  endAt: event.endAt,
  startTimeZone: event.startTimeZone,
  endTimeZone: event.endTimeZone,
  isAllDay: event.isAllDay,
  allDayStartDate: event.allDayStartDate,
  allDayEndDate: event.allDayEndDate,
  recurringEventId: event.recurringEventId,
  recurrence: event.recurrence,
  status: event.status,
  origin: event.origin,
  googleCalendarId: event.googleCalendarId,
  googleEventId: event.googleEventId,
  version: event.version,
  idempotencyKey: event.idempotencyKey,
  createdAt: event.createdAt,
  updatedAt: event.updatedAt,
};

/** The fields an update writes, plus the bookkeeping the service supplies. */
export interface EventUpdateWrite {
  patch: EventPatch;
  version: number;
  idempotencyKey: string;
}

/** A single page of the Later list, fetched with `limit + 1` rows to detect more. */
export interface LaterPageQuery {
  /** The exclusive lower bound: only Events on or after this instant. */
  from: Date;
  /** The compound cursor to resume after, or null for the first page. */
  cursor: EventCursor | null;
  /** How many rows to fetch (the caller passes `pageSize + 1`). */
  limit: number;
}

/**
 * Account-scoped access to Events and their deletion tombstones. Every operation
 * is keyed by `userId`, so a caller can only ever read or write its own
 * account's data. Foreign keys and these ownership predicates enforce tenancy.
 */
export function createEventRepository(database: Database) {
  return {
    async getById(userId: string, id: string): Promise<EventRecord | null> {
      const [row] = await database
        .select(recordColumns)
        .from(event)
        .where(and(eq(event.userId, userId), eq(event.id, id)))
        .limit(1);

      return row ?? null;
    },

    async isTombstoned(userId: string, id: string): Promise<boolean> {
      const [row] = await database
        .select({ id: eventTombstone.id })
        .from(eventTombstone)
        .where(
          and(eq(eventTombstone.userId, userId), eq(eventTombstone.id, id)),
        )
        .limit(1);

      return row !== undefined;
    },

    /**
     * Inserts a new local Event. When `exportSpec` is supplied — a writable
     * calendar exists — an `upsert` export job is enqueued in the same
     * transaction, so the outbox row is durable if and only if the Event itself
     * commits (the transactional-outbox guarantee).
     */
    async insert(
      userId: string,
      input: EventCreateRequest,
      exportSpec?: EventExportSpec,
    ): Promise<EventRecord> {
      const values = {
        id: input.id,
        userId,
        title: input.title,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        startTimeZone: input.startTimeZone,
        endTimeZone: input.endTimeZone,
        idempotencyKey: input.idempotencyKey,
      };

      if (!exportSpec) {
        const [row] = await database
          .insert(event)
          .values(values)
          .returning(recordColumns);
        return row;
      }

      return database.transaction(async (tx) => {
        const [row] = await tx
          .insert(event)
          .values(values)
          .returning(recordColumns);
        await enqueueExportJob(tx, {
          userId,
          eventId: input.id,
          operation: "upsert",
          googleCalendarId: exportSpec.googleCalendarId,
        });
        return row;
      });
    },

    /**
     * Applies an update and bumps the version. When `exportSpec` is supplied the
     * change is propagated to Google via an `upsert` export job enqueued in the
     * same transaction.
     */
    async update(
      userId: string,
      id: string,
      write: EventUpdateWrite,
      exportSpec?: EventExportSpec,
    ): Promise<EventRecord> {
      const { patch } = write;
      const set = {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.startAt !== undefined
          ? { startAt: new Date(patch.startAt) }
          : {}),
        ...(patch.endAt !== undefined ? { endAt: new Date(patch.endAt) } : {}),
        ...(patch.startTimeZone !== undefined
          ? { startTimeZone: patch.startTimeZone }
          : {}),
        ...(patch.endTimeZone !== undefined
          ? { endTimeZone: patch.endTimeZone }
          : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        version: write.version,
        idempotencyKey: write.idempotencyKey,
        updatedAt: new Date(),
      };
      const where = and(eq(event.userId, userId), eq(event.id, id));

      if (!exportSpec) {
        const [row] = await database
          .update(event)
          .set(set)
          .where(where)
          .returning(recordColumns);
        return row;
      }

      return database.transaction(async (tx) => {
        const [row] = await tx
          .update(event)
          .set(set)
          .where(where)
          .returning(recordColumns);
        await enqueueExportJob(tx, {
          userId,
          eventId: id,
          operation: "upsert",
          googleCalendarId: exportSpec.googleCalendarId,
        });
        return row;
      });
    },

    /**
     * Writes Google's provider identity back onto a local Event after it is
     * created upstream, so the mirror sync recognizes it by that identity and
     * never imports a duplicate. Bookkeeping only: it never bumps the version.
     */
    async linkGoogleIdentity(
      userId: string,
      id: string,
      identity: { googleCalendarId: string; googleEventId: string },
    ): Promise<void> {
      await database
        .update(event)
        .set({
          googleCalendarId: identity.googleCalendarId,
          googleEventId: identity.googleEventId,
          updatedAt: new Date(),
        })
        .where(and(eq(event.userId, userId), eq(event.id, id)));
    },

    /**
     * Local Events not yet mirrored to Google: `origin` local with no provider
     * identity. Drives the explicit export-on-reconnect choice (MEM-42), which
     * enqueues an export for each when the user grants a writable calendar.
     */
    async listUnexportedLocalEvents(userId: string): Promise<EventRecord[]> {
      return database
        .select(recordColumns)
        .from(event)
        .where(
          and(
            eq(event.userId, userId),
            eq(event.origin, "local"),
            isNull(event.googleEventId),
          ),
        )
        .orderBy(asc(event.startAt), asc(event.id));
    },

    /**
     * Inserts or refreshes the mirror row for one Google event, keyed by the
     * account-scoped provider identity `(user_id, google_calendar_id,
     * google_event_id)`. A re-delivered event therefore updates the existing
     * mirror in place instead of creating a duplicate, satisfying the import's
     * idempotency guarantee. Google stays authoritative, so `origin` is fixed to
     * `google` and the mutable fields are overwritten from the incoming mirror.
     */
    async upsertMirror(userId: string, mirror: MirrorEvent): Promise<void> {
      const now = new Date();
      const mutable = {
        title: mirror.title,
        startAt: new Date(mirror.startAt),
        endAt: new Date(mirror.endAt),
        startTimeZone: mirror.startTimeZone,
        endTimeZone: mirror.endTimeZone,
        isAllDay: mirror.isAllDay,
        allDayStartDate: mirror.allDayStartDate,
        allDayEndDate: mirror.allDayEndDate,
        recurringEventId: mirror.recurringEventId,
        recurrence: mirror.recurrence,
        status: mirror.status,
        updatedAt: now,
      };

      await database
        .insert(event)
        .values({
          id: crypto.randomUUID(),
          userId,
          origin: "google",
          googleCalendarId: mirror.googleCalendarId,
          googleEventId: mirror.googleEventId,
          idempotencyKey: crypto.randomUUID(),
          createdAt: now,
          ...mutable,
        })
        .onConflictDoUpdate({
          target: [event.userId, event.googleCalendarId, event.googleEventId],
          set: mutable,
        });
    },

    /**
     * Removes the mirror row for a Google event Google now reports as gone
     * (cancelled or deleted). Idempotent: deleting a row that never existed is a
     * no-op, so a cancellation delivered before any import is harmless.
     */
    async removeMirror(
      userId: string,
      googleCalendarId: string,
      googleEventId: string,
    ): Promise<void> {
      await database
        .delete(event)
        .where(
          and(
            eq(event.userId, userId),
            eq(event.googleCalendarId, googleCalendarId),
            eq(event.googleEventId, googleEventId),
          ),
        );
    },

    /**
     * Removes every mirror row for one Google calendar. Used for `410 Gone`
     * recovery: the sync horizon expired, so the affected calendar's mirror is
     * cleared before a bounded full resynchronization rebuilds it. Local Events
     * (origin `local`) never carry a `google_calendar_id`, so they are untouched.
     */
    async removeMirrorForCalendar(
      userId: string,
      googleCalendarId: string,
    ): Promise<void> {
      await database
        .delete(event)
        .where(
          and(
            eq(event.userId, userId),
            eq(event.googleCalendarId, googleCalendarId),
          ),
        );
    },

    /**
     * Deletes the Event, records a tombstone, and — when the Event was mirrored
     * to Google (it carries a provider identity) — enqueues a `delete` export
     * job, all in one transaction. The job captures the provider identity from
     * the row before it is removed, because the delete must reach Google after
     * the local row (and its identity) are gone. A recurring Event never
     * propagates its delete: Rails does not partially implement recurrence, so a
     * series deletion routes to Google. The local row is still removed; the next
     * mirror sync re-imports it while it remains on Google (Google authoritative).
     */
    async remove(userId: string, id: string): Promise<void> {
      await database.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            googleCalendarId: event.googleCalendarId,
            googleEventId: event.googleEventId,
            recurringEventId: event.recurringEventId,
            recurrence: event.recurrence,
          })
          .from(event)
          .where(and(eq(event.userId, userId), eq(event.id, id)))
          .limit(1);

        await tx
          .delete(event)
          .where(and(eq(event.userId, userId), eq(event.id, id)));
        await tx
          .insert(eventTombstone)
          .values({ id, userId })
          .onConflictDoNothing();

        if (
          existing?.googleCalendarId &&
          existing.googleEventId &&
          !isRecurringEvent(existing)
        ) {
          await enqueueExportJob(tx, {
            userId,
            eventId: id,
            operation: "delete",
            googleCalendarId: existing.googleCalendarId,
            googleEventId: existing.googleEventId,
          });
        }
      });
    },

    /**
     * Events whose start falls in the half-open window `[from, to)`, ordered by
     * start then id. Drives the weekly agenda's server-authoritative reads.
     */
    async listInWindow(
      userId: string,
      from: Date,
      to: Date,
    ): Promise<EventRecord[]> {
      return database
        .select(recordColumns)
        .from(event)
        .where(
          and(
            eq(event.userId, userId),
            gte(event.startAt, from),
            lt(event.startAt, to),
          ),
        )
        .orderBy(asc(event.startAt), asc(event.id));
    },

    /**
     * A cursor page of the Later list: Events starting on or after `from`,
     * ordered by the stable `(start_at, id)` key. When a cursor is supplied only
     * rows strictly after it are returned, so paging never repeats or skips a
     * row even as the set changes underneath it.
     */
    async listLater(
      userId: string,
      query: LaterPageQuery,
    ): Promise<EventRecord[]> {
      const afterCursor = query.cursor
        ? or(
            gt(event.startAt, new Date(query.cursor.startAt)),
            and(
              eq(event.startAt, new Date(query.cursor.startAt)),
              gt(event.id, query.cursor.id),
            ),
          )
        : undefined;

      return database
        .select(recordColumns)
        .from(event)
        .where(
          and(
            eq(event.userId, userId),
            gte(event.startAt, query.from),
            afterCursor,
          ),
        )
        .orderBy(asc(event.startAt), asc(event.id))
        .limit(query.limit);
    },
  };
}

export type EventRepository = ReturnType<typeof createEventRepository>;
