import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";

import type {
  DataExportSource,
  DataExportStatus,
} from "@/domain/account/data-export";
import type { ReminderPreferences } from "@/domain/notification/reminder";
import type { Database } from "@/server/db/connection";
import {
  area,
  dataExport,
  event,
  focusSession,
  inboxItem,
  reminderPreference,
  task,
  thought,
  user,
} from "@/server/db/schema";

/** A data-export job row, without the (potentially large) payload column. */
export interface DataExportRecord {
  id: string;
  userId: string;
  status: DataExportStatus;
  byteSize: number | null;
  attempts: number;
  lastErrorCode: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}

/** A completed archive ready to stream to the browser. */
export interface DataExportDownload {
  payload: string;
  completedAt: Date;
  expiresAt: Date | null;
}

/** What a durable export job records when it finishes assembling the archive. */
export interface CompleteDataExportInput {
  payload: string;
  byteSize: number;
  expiresAt: Date;
}

const recordColumns = {
  id: dataExport.id,
  userId: dataExport.userId,
  status: dataExport.status,
  byteSize: dataExport.byteSize,
  attempts: dataExport.attempts,
  lastErrorCode: dataExport.lastErrorCode,
  requestedAt: dataExport.requestedAt,
  completedAt: dataExport.completedAt,
  expiresAt: dataExport.expiresAt,
};

function toRecord(row: {
  id: string;
  userId: string;
  status: string;
  byteSize: number | null;
  attempts: number;
  lastErrorCode: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}): DataExportRecord {
  return { ...row, status: row.status as DataExportRecord["status"] };
}

const iso = (value: Date): string => value.toISOString();
const isoOrNull = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

/** PostgreSQL's `unique_violation` SQLSTATE, raised by the one-active index. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/** The account's in-flight (pending or processing) export, if any. */
async function findActiveExport(
  database: Database,
  userId: string,
): Promise<DataExportRecord | null> {
  const [row] = await database
    .select(recordColumns)
    .from(dataExport)
    .where(
      and(
        eq(dataExport.userId, userId),
        sql`${dataExport.status} in ('pending', 'processing')`,
      ),
    )
    .limit(1);

  return row ? toRecord(row) : null;
}

/**
 * Account-scoped persistence for data exports (MEM-48). Every operation is keyed
 * by `userId`, so a caller can only ever read or advance its own account's
 * export, and {@link collectAccountData} only ever reads that account's rows.
 * The write path is the durable-outbox lifecycle (pending → processing →
 * completed/failed) mirrored from the Calendar sync/export outboxes; the read
 * path assembles the export source and streams a finished archive.
 */
export function createDataExportRepository(database: Database) {
  return {
    /**
     * Requests an export. At most one may be in flight per account (a partial
     * unique index enforces it), so a request made while one is already
     * `pending`/`processing` returns that existing job with `created: false`
     * rather than enqueuing a second. Otherwise a fresh `pending` row is inserted.
     */
    async create(
      userId: string,
    ): Promise<{ created: boolean; record: DataExportRecord }> {
      const existing = await findActiveExport(database, userId);
      if (existing) {
        return { created: false, record: existing };
      }

      try {
        const [inserted] = await database
          .insert(dataExport)
          .values({ id: crypto.randomUUID(), userId })
          .returning(recordColumns);

        return { created: true, record: toRecord(inserted) };
      } catch (error) {
        // A concurrent request won the race and inserted the one active export
        // first (partial unique index `data_export_one_active_idx`). Re-arm to
        // that row instead of surfacing the unique violation as a 500.
        if (isUniqueViolation(error)) {
          const active = await findActiveExport(database, userId);
          if (active) {
            return { created: false, record: active };
          }
        }
        throw error;
      }
    },

    /** The account's most recent export, or null if it has never requested one. */
    async getLatest(userId: string): Promise<DataExportRecord | null> {
      const [row] = await database
        .select(recordColumns)
        .from(dataExport)
        .where(eq(dataExport.userId, userId))
        .orderBy(desc(dataExport.createdAt), desc(dataExport.id))
        .limit(1);

      return row ? toRecord(row) : null;
    },

    async getById(id: string): Promise<DataExportRecord | null> {
      const [row] = await database
        .select(recordColumns)
        .from(dataExport)
        .where(eq(dataExport.id, id))
        .limit(1);

      return row ? toRecord(row) : null;
    },

    /**
     * The account's most recent completed archive with its stored payload, for
     * the download route. Returns null when there is no completed export; expiry
     * is judged by the caller against `expiresAt` so an expired archive is a
     * distinct, explainable state rather than a silent miss.
     */
    async getLatestCompletedDownload(
      userId: string,
    ): Promise<DataExportDownload | null> {
      const [row] = await database
        .select({
          payload: dataExport.payload,
          completedAt: dataExport.completedAt,
          expiresAt: dataExport.expiresAt,
        })
        .from(dataExport)
        .where(
          and(
            eq(dataExport.userId, userId),
            eq(dataExport.status, "completed"),
          ),
        )
        .orderBy(desc(dataExport.completedAt), desc(dataExport.id))
        .limit(1);

      if (!row || row.payload === null || row.completedAt === null) {
        return null;
      }

      return {
        payload: row.payload,
        completedAt: row.completedAt,
        expiresAt: row.expiresAt,
      };
    },

    /** The oldest pending jobs, for the dispatcher to drain to Inngest. */
    async listPending(limit: number): Promise<DataExportRecord[]> {
      const rows = await database
        .select(recordColumns)
        .from(dataExport)
        .where(eq(dataExport.status, "pending"))
        .orderBy(asc(dataExport.createdAt), asc(dataExport.id))
        .limit(limit);

      return rows.map(toRecord);
    },

    /** Marks a job in-flight and counts the attempt. Idempotent to re-runs. */
    async markProcessing(id: string): Promise<void> {
      await database
        .update(dataExport)
        .set({
          status: "processing",
          attempts: sql`${dataExport.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(dataExport.id, id));
    },

    /** Stores the finished archive and its bounded download window. */
    async markCompleted(
      id: string,
      input: CompleteDataExportInput,
    ): Promise<void> {
      const now = new Date();
      await database
        .update(dataExport)
        .set({
          status: "completed",
          payload: input.payload,
          byteSize: input.byteSize,
          lastErrorCode: null,
          completedAt: now,
          expiresAt: input.expiresAt,
          updatedAt: now,
        })
        .where(eq(dataExport.id, id));
    },

    /** Records a failure with a safe error code — never exported content. */
    async markFailed(id: string, code: string): Promise<void> {
      await database
        .update(dataExport)
        .set({ status: "failed", lastErrorCode: code, updatedAt: new Date() })
        .where(eq(dataExport.id, id));
    },

    /**
     * Expires completed archives whose download window has closed: marks them
     * `expired` and clears the stored payload so a user's data is not retained on
     * the server past its TTL. Idempotent — an already-expired row is skipped.
     * Returns the count expired.
     */
    async expireCompleted(now: Date): Promise<number> {
      const expired = await database
        .update(dataExport)
        .set({ status: "expired", payload: null, updatedAt: now })
        .where(
          and(
            eq(dataExport.status, "completed"),
            lte(dataExport.expiresAt, now),
          ),
        )
        .returning({ id: dataExport.id });

      return expired.length;
    },

    /**
     * Reads the account's app-owned data into the export source. Mirrored Google
     * Events are read here too (the domain builder drops them); the connection
     * and any tokens are never touched. Soft-deleted Thoughts are excluded.
     */
    async collectAccountData(userId: string): Promise<DataExportSource | null> {
      const [account] = await database
        .select({
          name: user.name,
          email: user.email,
          timezone: user.timezone,
          locale: user.locale,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);

      if (!account) {
        return null;
      }

      const [
        areas,
        tasks,
        thoughts,
        inboxItems,
        events,
        focusSessions,
        reminders,
      ] = await Promise.all([
        database
          .select({
            id: area.id,
            name: area.name,
            createdAt: area.createdAt,
            updatedAt: area.updatedAt,
          })
          .from(area)
          .where(eq(area.userId, userId))
          .orderBy(asc(area.createdAt), asc(area.id)),
        database
          .select({
            id: task.id,
            title: task.title,
            status: task.status,
            scheduledDate: task.scheduledDate,
            scheduledTime: task.scheduledTime,
            estimateMinutes: task.estimateMinutes,
            energy: task.energy,
            important: task.important,
            notes: task.notes,
            areaId: task.areaId,
            completedAt: task.completedAt,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          })
          .from(task)
          .where(eq(task.userId, userId))
          .orderBy(asc(task.createdAt), asc(task.id)),
        database
          .select({
            id: thought.id,
            title: thought.title,
            body: thought.body,
            createdAt: thought.createdAt,
            updatedAt: thought.updatedAt,
          })
          .from(thought)
          .where(and(eq(thought.userId, userId), isNull(thought.deletedAt)))
          .orderBy(asc(thought.createdAt), asc(thought.id)),
        database
          .select({
            id: inboxItem.id,
            title: inboxItem.title,
            seenAt: inboxItem.seenAt,
            classifiedAt: inboxItem.classifiedAt,
            createdAt: inboxItem.createdAt,
            updatedAt: inboxItem.updatedAt,
          })
          .from(inboxItem)
          .where(eq(inboxItem.userId, userId))
          .orderBy(asc(inboxItem.createdAt), asc(inboxItem.id)),
        database
          .select({
            id: event.id,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            startTimeZone: event.startTimeZone,
            endTimeZone: event.endTimeZone,
            isAllDay: event.isAllDay,
            allDayStartDate: event.allDayStartDate,
            allDayEndDate: event.allDayEndDate,
            status: event.status,
            origin: event.origin,
            googleCalendarId: event.googleCalendarId,
            googleEventId: event.googleEventId,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
          })
          .from(event)
          .where(eq(event.userId, userId))
          .orderBy(asc(event.startAt), asc(event.id)),
        database
          .select({
            id: focusSession.id,
            taskId: focusSession.taskId,
            status: focusSession.status,
            accumulatedSeconds: focusSession.accumulatedSeconds,
            distractionCount: focusSession.distractionCount,
            startedAt: focusSession.startedAt,
            completedAt: focusSession.completedAt,
            createdAt: focusSession.createdAt,
            updatedAt: focusSession.updatedAt,
          })
          .from(focusSession)
          .where(eq(focusSession.userId, userId))
          .orderBy(asc(focusSession.startedAt), asc(focusSession.id)),
        database
          .select({
            enabled: reminderPreference.enabled,
            headsUpEnabled: reminderPreference.headsUpEnabled,
            leadMinutes: reminderPreference.leadMinutes,
            atTimeEnabled: reminderPreference.atTimeEnabled,
            eventCueEnabled: reminderPreference.eventCueEnabled,
          })
          .from(reminderPreference)
          .where(eq(reminderPreference.userId, userId))
          .limit(1),
      ]);

      const reminderPreferences: ReminderPreferences | null = reminders[0]
        ? {
            enabled: reminders[0].enabled,
            headsUpEnabled: reminders[0].headsUpEnabled,
            leadMinutes: reminders[0]
              .leadMinutes as ReminderPreferences["leadMinutes"],
            atTimeEnabled: reminders[0].atTimeEnabled,
            eventCueEnabled: reminders[0].eventCueEnabled,
          }
        : null;

      return {
        account,
        areas: areas.map((row) => ({
          ...row,
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        })),
        tasks: tasks.map((row) => ({
          ...row,
          completedAt: isoOrNull(row.completedAt),
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        })),
        thoughts: thoughts.map((row) => ({
          ...row,
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        })),
        inboxItems: inboxItems.map((row) => ({
          ...row,
          seenAt: isoOrNull(row.seenAt),
          classifiedAt: isoOrNull(row.classifiedAt),
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        })),
        events: events.map((row) => ({
          ...row,
          startAt: iso(row.startAt),
          endAt: iso(row.endAt),
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        })),
        focusSessions: focusSessions.map((row) => ({
          ...row,
          completedAt: isoOrNull(row.completedAt),
          startedAt: iso(row.startedAt),
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        })),
        reminderPreferences,
      };
    },
  };
}

export type DataExportRepository = ReturnType<
  typeof createDataExportRepository
>;
