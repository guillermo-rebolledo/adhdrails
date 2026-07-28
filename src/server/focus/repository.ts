import { and, eq, ne } from "drizzle-orm";

import type { FocusSessionStatus } from "@/domain/focus/session";
import type { Database } from "@/server/db/connection";
import { focusSession } from "@/server/db/schema";

export interface FocusSessionRecord {
  id: string;
  taskId: string;
  status: string;
  accumulatedSeconds: number;
  lastResumedAt: Date | null;
  distractionCount: number;
  startedAt: Date;
  completedAt: Date | null;
  version: number;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const recordColumns = {
  id: focusSession.id,
  taskId: focusSession.taskId,
  status: focusSession.status,
  accumulatedSeconds: focusSession.accumulatedSeconds,
  lastResumedAt: focusSession.lastResumedAt,
  distractionCount: focusSession.distractionCount,
  startedAt: focusSession.startedAt,
  completedAt: focusSession.completedAt,
  version: focusSession.version,
  idempotencyKey: focusSession.idempotencyKey,
  createdAt: focusSession.createdAt,
  updatedAt: focusSession.updatedAt,
};

/** The fields a start writes; the running anchor is supplied by the service. */
export interface FocusSessionInsert {
  id: string;
  taskId: string;
  idempotencyKey: string;
  startedAt: Date;
  lastResumedAt: Date;
}

/** The timing a transition writes, plus the bookkeeping the service supplies. */
export interface FocusSessionUpdateWrite {
  status: FocusSessionStatus;
  accumulatedSeconds: number;
  lastResumedAt: Date | null;
  completedAt: Date | null;
  version: number;
  idempotencyKey: string;
}

/**
 * Account-scoped access to Focus Sessions. Every operation is keyed by `userId`,
 * so a caller can only ever read or write its own account's session. The partial
 * unique index enforces the account-wide single-active invariant at the database
 * level; {@link getActive} reads it and `insert` relies on it to reject a
 * competing concurrent start.
 */
export function createFocusSessionRepository(database: Database) {
  return {
    async getById(
      userId: string,
      id: string,
    ): Promise<FocusSessionRecord | null> {
      const [row] = await database
        .select(recordColumns)
        .from(focusSession)
        .where(and(eq(focusSession.userId, userId), eq(focusSession.id, id)))
        .limit(1);

      return row ?? null;
    },

    /** The account's active (running or paused) session, or null if none. */
    async getActive(userId: string): Promise<FocusSessionRecord | null> {
      const [row] = await database
        .select(recordColumns)
        .from(focusSession)
        .where(
          and(
            eq(focusSession.userId, userId),
            ne(focusSession.status, "completed"),
          ),
        )
        .limit(1);

      return row ?? null;
    },

    async insert(
      userId: string,
      input: FocusSessionInsert,
    ): Promise<FocusSessionRecord> {
      const [row] = await database
        .insert(focusSession)
        .values({
          id: input.id,
          userId,
          taskId: input.taskId,
          idempotencyKey: input.idempotencyKey,
          status: "running",
          accumulatedSeconds: 0,
          lastResumedAt: input.lastResumedAt,
          startedAt: input.startedAt,
        })
        .returning(recordColumns);

      return row;
    },

    async update(
      userId: string,
      id: string,
      write: FocusSessionUpdateWrite,
    ): Promise<FocusSessionRecord> {
      const [row] = await database
        .update(focusSession)
        .set({
          status: write.status,
          accumulatedSeconds: write.accumulatedSeconds,
          lastResumedAt: write.lastResumedAt,
          completedAt: write.completedAt,
          version: write.version,
          idempotencyKey: write.idempotencyKey,
          updatedAt: new Date(),
        })
        .where(and(eq(focusSession.userId, userId), eq(focusSession.id, id)))
        .returning(recordColumns);

      return row;
    },
  };
}

export type FocusSessionRepository = ReturnType<
  typeof createFocusSessionRepository
>;

/** Whether a thrown database error is a unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
