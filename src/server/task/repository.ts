import { and, asc, desc, eq, gt, isNull, lt, or } from "drizzle-orm";

import type {
  TaskCollection,
  TaskCursor,
  TaskEnergyFilter,
} from "@/domain/task/collection";
import type { TaskCreateRequest, TaskPatch } from "@/domain/task/task";
import type { Database } from "@/server/db/connection";
import { task, taskTombstone } from "@/server/db/schema";

export interface TaskRecord {
  id: string;
  title: string;
  status: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  estimateMinutes: number | null;
  energy: string | null;
  important: boolean;
  notes: string;
  areaId: string | null;
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
  scheduledDate: task.scheduledDate,
  scheduledTime: task.scheduledTime,
  estimateMinutes: task.estimateMinutes,
  energy: task.energy,
  important: task.important,
  notes: task.notes,
  areaId: task.areaId,
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

export interface TaskCollectionPageQuery {
  collection: TaskCollection;
  today: string | null;
  areaId: string | null;
  energy: TaskEnergyFilter | null;
  cursor: TaskCursor | null;
  direction: "forward" | "backward";
  /** The service passes `pageSize + 1` so it can detect another page. */
  limit: number;
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
          // Planning metadata is optional; an omitted field falls back to the
          // column default (null, or `false`/`""` for important/notes).
          scheduledDate: input.scheduledDate ?? null,
          scheduledTime: input.scheduledTime ?? null,
          estimateMinutes: input.estimateMinutes ?? null,
          energy: input.energy ?? null,
          ...(input.important !== undefined
            ? { important: input.important }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          areaId: input.areaId ?? null,
        })
        .returning(recordColumns);

      return row;
    },

    async update(
      userId: string,
      id: string,
      write: TaskUpdateWrite,
    ): Promise<TaskRecord> {
      const { patch } = write;
      const [row] = await database
        .update(task)
        .set({
          // Only the fields present in the patch are written; a field set to
          // `null` clears it, while an absent field is left untouched.
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...("scheduledDate" in patch
            ? { scheduledDate: patch.scheduledDate ?? null }
            : {}),
          ...("scheduledTime" in patch
            ? { scheduledTime: patch.scheduledTime ?? null }
            : {}),
          ...("estimateMinutes" in patch
            ? { estimateMinutes: patch.estimateMinutes ?? null }
            : {}),
          ...("energy" in patch ? { energy: patch.energy ?? null } : {}),
          ...(patch.important !== undefined
            ? { important: patch.important }
            : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...("areaId" in patch ? { areaId: patch.areaId ?? null } : {}),
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

    /**
     * One stable cursor page of a Task collection. Collection membership and
     * explicit filters are enforced in PostgreSQL so large inventories remain
     * bounded; every query resumes strictly after `(created_at, id)`.
     */
    async listCollection(
      userId: string,
      query: TaskCollectionPageQuery,
    ): Promise<TaskRecord[]> {
      const status =
        query.collection === "completed"
          ? eq(task.status, "completed")
          : eq(task.status, "active");
      const schedule =
        query.collection === "today"
          ? eq(task.scheduledDate, query.today!)
          : query.collection === "upcoming"
            ? gt(task.scheduledDate, query.today!)
            : undefined;
      const energy =
        query.collection === "today" || query.collection === "upcoming"
          ? undefined
          : query.energy === "unset"
            ? isNull(task.energy)
            : query.energy
              ? eq(task.energy, query.energy)
              : undefined;
      const afterCursor = query.cursor
        ? query.direction === "backward"
          ? or(
              lt(task.createdAt, new Date(query.cursor.createdAt)),
              and(
                eq(task.createdAt, new Date(query.cursor.createdAt)),
                lt(task.id, query.cursor.id),
              ),
            )
          : or(
              gt(task.createdAt, new Date(query.cursor.createdAt)),
              and(
                eq(task.createdAt, new Date(query.cursor.createdAt)),
                gt(task.id, query.cursor.id),
              ),
            )
        : undefined;

      return database
        .select(recordColumns)
        .from(task)
        .where(
          and(
            eq(task.userId, userId),
            status,
            schedule,
            query.areaId ? eq(task.areaId, query.areaId) : undefined,
            energy,
            afterCursor,
          ),
        )
        .orderBy(
          query.direction === "backward"
            ? desc(task.createdAt)
            : asc(task.createdAt),
          query.direction === "backward" ? desc(task.id) : asc(task.id),
        )
        .limit(query.limit);
    },
  };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
