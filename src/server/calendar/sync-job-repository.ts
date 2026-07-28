import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";

import type { Database } from "@/server/db/connection";
import { calendarSyncJob } from "@/server/db/schema";

/** A row in the Calendar synchronization outbox. */
export interface SyncJobRecord {
  id: string;
  userId: string;
  googleCalendarId: string;
  channelId: string;
  messageNumber: number;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  lastErrorCode: string | null;
}

/** What a verified notification records when it enqueues a sync. */
export interface EnqueueSyncJobInput {
  userId: string;
  googleCalendarId: string;
  channelId: string;
  messageNumber: number;
}

const recordColumns = {
  id: calendarSyncJob.id,
  userId: calendarSyncJob.userId,
  googleCalendarId: calendarSyncJob.googleCalendarId,
  channelId: calendarSyncJob.channelId,
  messageNumber: calendarSyncJob.messageNumber,
  status: calendarSyncJob.status,
  attempts: calendarSyncJob.attempts,
  lastErrorCode: calendarSyncJob.lastErrorCode,
};

function toRecord(row: {
  id: string;
  userId: string;
  googleCalendarId: string;
  channelId: string;
  messageNumber: number;
  status: string;
  attempts: number;
  lastErrorCode: string | null;
}): SyncJobRecord {
  return { ...row, status: row.status as SyncJobRecord["status"] };
}

/**
 * The transactional outbox for Calendar incremental sync (MEM-41). A verified
 * webhook durably records one job per delivered notification here before it
 * acknowledges; a dispatcher drains the pending rows to Inngest, and the Inngest
 * function marks each row's lifecycle. The unique `(channel_id, message_number)`
 * index makes {@link enqueue} idempotent: a duplicate delivery returns the
 * existing job instead of creating a second one, so a re-sent notification never
 * enqueues duplicate work.
 */
export function createCalendarSyncJobRepository(database: Database) {
  return {
    /**
     * Records a job for a delivered notification. Returns `enqueued: true` with
     * the new job the first time a `(channel, message number)` pair is seen, and
     * `enqueued: false` with the pre-existing job on any re-delivery.
     */
    async enqueue(
      input: EnqueueSyncJobInput,
    ): Promise<{ enqueued: boolean; job: SyncJobRecord }> {
      const [inserted] = await database
        .insert(calendarSyncJob)
        .values({
          id: crypto.randomUUID(),
          userId: input.userId,
          googleCalendarId: input.googleCalendarId,
          channelId: input.channelId,
          messageNumber: input.messageNumber,
        })
        .onConflictDoNothing({
          target: [calendarSyncJob.channelId, calendarSyncJob.messageNumber],
        })
        .returning(recordColumns);

      if (inserted) {
        return { enqueued: true, job: toRecord(inserted) };
      }

      const [existing] = await database
        .select(recordColumns)
        .from(calendarSyncJob)
        .where(
          and(
            eq(calendarSyncJob.channelId, input.channelId),
            eq(calendarSyncJob.messageNumber, input.messageNumber),
          ),
        )
        .limit(1);

      return { enqueued: false, job: toRecord(existing) };
    },

    async getById(id: string): Promise<SyncJobRecord | null> {
      const [row] = await database
        .select(recordColumns)
        .from(calendarSyncJob)
        .where(eq(calendarSyncJob.id, id))
        .limit(1);

      return row ? toRecord(row) : null;
    },

    /** The oldest pending jobs, for the dispatcher to drain to Inngest. */
    async listPending(limit: number): Promise<SyncJobRecord[]> {
      const rows = await database
        .select(recordColumns)
        .from(calendarSyncJob)
        .where(eq(calendarSyncJob.status, "pending"))
        .orderBy(asc(calendarSyncJob.createdAt), asc(calendarSyncJob.id))
        .limit(limit);

      return rows.map(toRecord);
    },

    /** Marks a job in-flight and counts the attempt. Idempotent to re-runs. */
    async markProcessing(id: string): Promise<void> {
      await database
        .update(calendarSyncJob)
        .set({
          status: "processing",
          attempts: sql`${calendarSyncJob.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(calendarSyncJob.id, id));
    },

    async markCompleted(id: string): Promise<void> {
      await database
        .update(calendarSyncJob)
        .set({
          status: "completed",
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(calendarSyncJob.id, id));
    },

    /** Records a failure with a safe error code — never a provider payload. */
    async markFailed(id: string, code: string): Promise<void> {
      await database
        .update(calendarSyncJob)
        .set({ status: "failed", lastErrorCode: code, updatedAt: new Date() })
        .where(eq(calendarSyncJob.id, id));
    },

    /**
     * Purges resolved outbox rows (`completed` or `failed`) last updated before
     * `cutoff` (MEM-43 retention). Pending and processing rows are never touched,
     * so no in-flight or undelivered work is lost; only finished operational
     * records are reclaimed. Returns the count removed.
     */
    async purgeResolvedBefore(cutoff: Date): Promise<number> {
      const removed = await database
        .delete(calendarSyncJob)
        .where(
          and(
            inArray(calendarSyncJob.status, ["completed", "failed"]),
            lt(calendarSyncJob.updatedAt, cutoff),
          ),
        )
        .returning({ id: calendarSyncJob.id });

      return removed.length;
    },
  };
}

export type CalendarSyncJobRepository = ReturnType<
  typeof createCalendarSyncJobRepository
>;
