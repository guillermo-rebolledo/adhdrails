import {
  taskCollectionPageResponseSchema,
  type TaskCollection,
  type TaskEnergyFilter,
} from "@/domain/task/collection";
import type { TaskResponse } from "@/domain/task/task";
import { apiRequest } from "@/lib/api-client";

import type { RailsDatabase } from "./db";

export interface TaskPageRequest {
  collection: TaskCollection;
  today: string;
  areaId: string | null;
  energy: TaskEnergyFilter | null;
  cursor: string | null;
  direction?: "forward" | "backward";
}

/** Query-owned view state: membership/order only, never Task entity fields. */
export interface LocalTaskPage {
  ids: string[];
  nextCursor: string | null;
  previousCursor: string | null;
}

function toLocalTask(task: TaskResponse) {
  return {
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
    createdAt: task.createdAt,
    deletedAt: null,
    syncState: "synced" as const,
  };
}

/**
 * Reconciles server-confirmed Task entities into Dexie without overwriting a
 * pending, failed, or conflicted local mutation. TanStack Query keeps only the
 * ordered IDs returned alongside this write.
 */
export async function reconcileTaskPage(
  db: RailsDatabase,
  tasks: readonly TaskResponse[],
): Promise<void> {
  await db.transaction("rw", db.tasks, async () => {
    for (const task of tasks) {
      const local = await db.tasks.get(task.id);
      if (
        !local ||
        (local.syncState === "synced" && task.version >= local.version)
      ) {
        await db.tasks.put(toLocalTask(task));
      }
    }
  });
}

/** Fetches one server page, reconciles its entities, and returns view IDs. */
export async function fetchTaskCollectionPage(
  db: RailsDatabase,
  request: TaskPageRequest,
): Promise<LocalTaskPage> {
  const params = new URLSearchParams({
    collection: request.collection,
    today: request.today,
  });
  if (request.areaId) params.set("areaId", request.areaId);
  if (request.energy) params.set("energy", request.energy);
  if (request.cursor) params.set("cursor", request.cursor);
  if (request.direction === "backward") params.set("direction", "backward");

  const response = await apiRequest<unknown>(
    `/api/v1/tasks?${params.toString()}`,
  );
  if (!response.ok || !response.body) {
    throw new Error("Could not load tasks.");
  }

  const page = taskCollectionPageResponseSchema.parse(response.body);
  await reconcileTaskPage(db, page.items);
  return {
    ids: page.items.map((task) => task.id),
    nextCursor: page.nextCursor,
    previousCursor: page.previousCursor,
  };
}
