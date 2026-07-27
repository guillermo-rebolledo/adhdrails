import { z } from "zod";

import {
  scheduledDateSchema,
  TASK_ENERGIES,
  taskResponseSchema,
  type TaskEnergy,
  type TaskStatus,
} from "./task";

/** The calm, bounded Task inventory views available from the Tasks screen. */
export const TASK_COLLECTIONS = [
  "today",
  "upcoming",
  "anytime",
  "completed",
] as const;
export const taskCollectionSchema = z.enum(TASK_COLLECTIONS);
export type TaskCollection = z.infer<typeof taskCollectionSchema>;

/** An explicit filter for Tasks whose Energy metadata has not been set. */
export const UNSET_ENERGY_FILTER = "unset" as const;
export const taskEnergyFilterSchema = z.enum([
  ...TASK_ENERGIES,
  UNSET_ENERGY_FILTER,
]);
export type TaskEnergyFilter = z.infer<typeof taskEnergyFilterSchema>;

/** A bounded page keeps long Task inventories responsive. */
export const TASK_COLLECTION_PAGE_SIZE = 20;
/** Retain at most 100 server-backed rows in one collection view. */
export const TASK_COLLECTION_MAX_PAGES = 5;
export const TASK_COLLECTION_WINDOW_SIZE =
  TASK_COLLECTION_PAGE_SIZE * TASK_COLLECTION_MAX_PAGES;

/**
 * Every collection uses the stable `(createdAt, id)` key. The account/status
 * index can serve this ordering, and the UUID tie-breaker makes page boundaries
 * deterministic even when multiple Tasks are created in one instant.
 */
export interface TaskCursor {
  createdAt: string;
  id: string;
}

const cursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

export function encodeTaskCursor(cursor: TaskCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Returns `null` for a malformed cursor so callers can safely start over. */
export function decodeTaskCursor(token: string): TaskCursor | null {
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(token, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
}

/** Splits a `limit + 1` repository result into a page and its next cursor. */
export function paginateTasks<T>(
  rows: readonly T[],
  limit: number,
  toCursor: (row: T) => TaskCursor,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) {
    return { items: rows.slice(), nextCursor: null };
  }

  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: encodeTaskCursor(toCursor(items[items.length - 1])),
  };
}

/** The fields needed to decide local collection membership and filtering. */
export interface CollectionTask {
  status: TaskStatus;
  scheduledDate: string | null;
  energy: TaskEnergy | null;
  areaId: string | null;
  deletedAt?: string | null;
}

export interface TaskCollectionFilters {
  areaId?: string | null;
  energy?: TaskEnergyFilter | null;
}

/**
 * Applies the same public collection semantics to the local replica that the
 * server applies to PostgreSQL. Anytime means every active Task, including
 * scheduled and unscheduled work. A past schedule never creates an overdue
 * state; it remains calmly discoverable in Anytime.
 */
export function taskMatchesCollection(
  task: CollectionTask,
  collection: TaskCollection,
  today: string,
): boolean {
  if (task.deletedAt) {
    return false;
  }
  if (collection === "completed") {
    return task.status === "completed";
  }
  if (task.status !== "active") {
    return false;
  }
  if (collection === "today") {
    return task.scheduledDate === today;
  }
  if (collection === "upcoming") {
    return task.scheduledDate !== null && task.scheduledDate > today;
  }
  return true;
}

/** Area and Energy filters are deliberate narrowing controls, never defaults. */
export function taskMatchesFilters(
  task: CollectionTask,
  filters: TaskCollectionFilters,
  collection: TaskCollection = "anytime",
): boolean {
  if (filters.areaId && task.areaId !== filters.areaId) {
    return false;
  }
  // Energy describes flexible capacity. It must never hide a fixed commitment.
  if (collection === "today" || collection === "upcoming") {
    return true;
  }
  if (filters.energy === UNSET_ENERGY_FILTER) {
    return task.energy === null;
  }
  if (filters.energy && task.energy !== filters.energy) {
    return false;
  }
  return true;
}

export const taskCollectionQuerySchema = z
  .object({
    collection: taskCollectionSchema.default("anytime"),
    today: scheduledDateSchema.nullable().default(null),
    areaId: z.uuid().nullable().default(null),
    energy: taskEnergyFilterSchema.nullable().default(null),
    cursor: z.string().nullable().default(null),
    direction: z.enum(["forward", "backward"]).default("forward"),
  })
  .superRefine((query, context) => {
    if (
      (query.collection === "today" || query.collection === "upcoming") &&
      !query.today
    ) {
      context.addIssue({
        code: "custom",
        path: ["today"],
        message: "The account-local date is required for this collection.",
      });
    }
  });

export type TaskCollectionQuery = z.infer<typeof taskCollectionQuerySchema>;

/** Shared wire contract for the collection route and offline reconciliation. */
export const taskCollectionPageResponseSchema = z.object({
  items: z.array(taskResponseSchema),
  nextCursor: z.string().nullable(),
  previousCursor: z.string().nullable().default(null),
});
export type TaskCollectionPageResponse = z.infer<
  typeof taskCollectionPageResponseSchema
>;
