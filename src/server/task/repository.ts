import { and, asc, eq } from "drizzle-orm";

import type { TaskCreateRequest, TaskPatch } from "@/domain/task/task";
import type { Database } from "@/server/db/connection";
import { task, taskTombstone } from "@/server/db/schema";

export interface TaskRecord {
  id: string;
  title: string;
  status: string;
  completedAt: Date | null;
  version: number;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const recordColumns = {
  id: task.id,
  title: task.title,
  status: task.status,
  completedAt: task.completedAt,
  version: task.version,
  idempotencyKey: task.idempotencyKey,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
};

/** The fields an update writes, plus the bookkeeping the service supplies. */
export interface TaskUpdateWrite {
  patch: TaskPatch;
  completedAt: Date | null;
  version: number;
  idempotencyKey: string;
}

/**
 * Account-scoped access to Tasks and their deletion tombstones. Every operation
 * is keyed by `userId`, so a caller can only ever read or write its own
 * account's data. Foreign keys and these ownership predicates enforce tenancy.
 */
export function createTaskRepository(database: Database) {
  return {
    async getById(userId: string, id: string): Promise<TaskRecord | null> {
      const [row] = await database
        .select(recordColumns)
        .from(task)
        .where(and(eq(task.userId, userId), eq(task.id, id)))
        .limit(1);

      return row ?? null;
    },

    async isTombstoned(userId: string, id: string): Promise<boolean> {
      const [row] = await database
        .select({ id: taskTombstone.id })
        .from(taskTombstone)
        .where(and(eq(taskTombstone.userId, userId), eq(taskTombstone.id, id)))
        .limit(1);

      return row !== undefined;
    },

    async insert(
      userId: string,
      input: TaskCreateRequest,
    ): Promise<TaskRecord> {
      const [row] = await database
        .insert(task)
        .values({
          id: input.id,
          userId,
          title: input.title,
          idempotencyKey: input.idempotencyKey,
        })
        .returning(recordColumns);

      return row;
    },

    async update(
      userId: string,
      id: string,
      write: TaskUpdateWrite,
    ): Promise<TaskRecord> {
      const [row] = await database
        .update(task)
        .set({
          ...(write.patch.title !== undefined
            ? { title: write.patch.title }
            : {}),
          ...(write.patch.status !== undefined
            ? { status: write.patch.status }
            : {}),
          completedAt: write.completedAt,
          version: write.version,
          idempotencyKey: write.idempotencyKey,
          updatedAt: new Date(),
        })
        .where(and(eq(task.userId, userId), eq(task.id, id)))
        .returning(recordColumns);

      return row;
    },

    /** Deletes the Task and records a tombstone in one transaction. */
    async remove(userId: string, id: string): Promise<void> {
      await database.transaction(async (tx) => {
        await tx
          .delete(task)
          .where(and(eq(task.userId, userId), eq(task.id, id)));
        await tx
          .insert(taskTombstone)
          .values({ id, userId })
          .onConflictDoNothing();
      });
    },

    async listActiveForAccount(userId: string): Promise<TaskRecord[]> {
      return database
        .select(recordColumns)
        .from(task)
        .where(and(eq(task.userId, userId), eq(task.status, "active")))
        .orderBy(asc(task.createdAt), asc(task.id));
    },
  };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
