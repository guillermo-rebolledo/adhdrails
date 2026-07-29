import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";

import type { EventExportOperation } from "@/domain/calendar/export";
import type { Database } from "@/server/db/connection";
import { eventExportJob } from "@/server/db/schema";

/** Any Drizzle client — the base connection or a transaction — an enqueue runs on. */
type DbClient =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The lifecycle status of an export job. */
export type ExportJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "skipped";

/** A row in the Event export outbox. */
export interface ExportJobRecord {
  id: string;
  userId: string;
  eventId: string;
  operation: EventExportOperation;
  googleCalendarId: string | null;
  googleEventId: string | null;
  status: ExportJobStatus;
  attempts: number;
  lastErrorCode: string | null;
}

/** What a mutation records when it enqueues an export. */
export interface EnqueueExportJobInput {
  userId: string;
  eventId: string;
  operation: EventExportOperation;
  /** The write target (upsert) or the calendar to remove from (delete). */
  googleCalendarId?: string | null;
  /** The provider identity to patch or delete, when already known. */
  googleEventId?: string | null;
}

const recordColumns = {
  id: eventExportJob.id,
  userId: eventExportJob.userId,
  eventId: eventExportJob.eventId,
  operation: eventExportJob.operation,
  googleCalendarId: eventExportJob.googleCalendarId,
  googleEventId: eventExportJob.googleEventId,
  status: eventExportJob.status,
  attempts: eventExportJob.attempts,
  lastErrorCode: eventExportJob.lastErrorCode,
};

function toRecord(row: {
  id: string;
  userId: string;
  eventId: string;
  operation: string;
  googleCalendarId: string | null;
  googleEventId: string | null;
  status: string;
  attempts: number;
  lastErrorCode: string | null;
}): ExportJobRecord {
  return {
    ...row,
    operation: row.operation as EventExportOperation,
    status: row.status as ExportJobStatus,
  };
}

/**
 * Records — or re-arms — one export job. The unique `(user_id, event_id,
 * operation)` index makes a repeated mutation reset the existing job back to
 * `pending` (clearing its attempts and any prior error and refreshing the write
 * target) rather than enqueuing a duplicate. Runs on the base connection or,
 * when passed a transaction, atomically with the triggering Event mutation so
 * the outbox row is only durable if the mutation itself commits. Returns the
 * job so a caller can dispatch it.
 */
export async function enqueueExportJob(
  client: DbClient,
  input: EnqueueExportJobInput,
): Promise<ExportJobRecord> {
  const [row] = await client
    .insert(eventExportJob)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      eventId: input.eventId,
      operation: input.operation,
      googleCalendarId: input.googleCalendarId ?? null,
      googleEventId: input.googleEventId ?? null,
    })
    .onConflictDoUpdate({
      target: [
        eventExportJob.userId,
        eventExportJob.eventId,
        eventExportJob.operation,
      ],
      set: {
        status: "pending",
        attempts: 0,
        lastErrorCode: null,
        googleCalendarId: input.googleCalendarId ?? null,
        googleEventId: input.googleEventId ?? null,
        updatedAt: new Date(),
      },
    })
    .returning(recordColumns);

  return toRecord(row);
}

/**
 * The transactional outbox for outbound Event synchronization (MEM-42). A
 * verified Event mutation records one job here in its own transaction; a
 * scheduled drain hands the pending rows to the Inngest exporter, which advances
 * each row's lifecycle. Terminal outcomes are `completed` (written to Google),
 * `skipped` (nothing to write — e.g. no writable calendar, or the Event was
 * deleted before its export ran), and `failed` (a safe error code, no retry).
 * The terminal transitions are guarded on `processing`, so a mutation that
 * re-arms a job mid-run leaves it `pending` for the drain to pick up rather than
 * losing the newer change.
 */
export function createEventExportJobRepository(database: Database) {
  return {
    enqueue(input: EnqueueExportJobInput): Promise<ExportJobRecord> {
      return enqueueExportJob(database, input);
    },

    async getById(id: string): Promise<ExportJobRecord | null> {
      const [row] = await database
        .select(recordColumns)
        .from(eventExportJob)
        .where(eq(eventExportJob.id, id))
        .limit(1);

      return row ? toRecord(row) : null;
    },

    /** The oldest pending jobs, for the drain to hand to the exporter. */
    async listPending(limit: number): Promise<ExportJobRecord[]> {
      const rows = await database
        .select(recordColumns)
        .from(eventExportJob)
        .where(eq(eventExportJob.status, "pending"))
        .orderBy(asc(eventExportJob.createdAt), asc(eventExportJob.id))
        .limit(limit);

      return rows.map(toRecord);
    },

    /** Marks a job in-flight and counts the attempt. */
    async markProcessing(id: string): Promise<void> {
      await database
        .update(eventExportJob)
        .set({
          status: "processing",
          attempts: sql`${eventExportJob.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(eventExportJob.id, id));
    },

    /**
     * Marks a job done. Guarded on `processing` so a mutation that re-armed the
     * job to `pending` while it ran is preserved for the next drain instead of
     * being overwritten — the newer change is never lost.
     */
    async markCompleted(id: string): Promise<void> {
      await database
        .update(eventExportJob)
        .set({
          status: "completed",
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(eventExportJob.id, id),
            eq(eventExportJob.status, "processing"),
          ),
        );
    },

    /** Marks a job a terminal no-op (nothing to write). Guarded on `processing`. */
    async markSkipped(id: string, code: string): Promise<void> {
      await database
        .update(eventExportJob)
        .set({ status: "skipped", lastErrorCode: code, updatedAt: new Date() })
        .where(
          and(
            eq(eventExportJob.id, id),
            eq(eventExportJob.status, "processing"),
          ),
        );
    },

    /** Records a terminal failure with a safe code — never a provider payload. */
    async markFailed(id: string, code: string): Promise<void> {
      await database
        .update(eventExportJob)
        .set({ status: "failed", lastErrorCode: code, updatedAt: new Date() })
        .where(
          and(
            eq(eventExportJob.id, id),
            eq(eventExportJob.status, "processing"),
          ),
        );
    },

    /**
     * Purges resolved export rows (`completed`, `failed`, or `skipped`) last
     * updated before `cutoff` (MEM-43 retention). Pending and processing rows are
     * never touched, so no undelivered export is lost; only finished operational
     * records are reclaimed. Returns the count removed.
     */
    async purgeResolvedBefore(cutoff: Date): Promise<number> {
      const removed = await database
        .delete(eventExportJob)
        .where(
          and(
            inArray(eventExportJob.status, ["completed", "failed", "skipped"]),
            lt(eventExportJob.updatedAt, cutoff),
          ),
        )
        .returning({ id: eventExportJob.id });

      return removed.length;
    },
  };
}

export type EventExportJobRepository = ReturnType<
  typeof createEventExportJobRepository
>;
