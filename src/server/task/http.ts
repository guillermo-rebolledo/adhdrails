import {
  type TaskResponse,
  taskResponseSchema,
  taskStatusSchema,
} from "@/domain/task/task";
import {
  conflictProblem,
  goneProblem,
  notFoundProblem,
  validationProblem,
} from "@/server/http/problem";

import type { TaskRecord } from "./repository";
import type { TaskCreateResult, TaskUpdateResult } from "./service";

export function serializeTask(record: TaskRecord): TaskResponse {
  return taskResponseSchema.parse({
    id: record.id,
    title: record.title,
    status: taskStatusSchema.parse(record.status),
    completedAt: record.completedAt?.toISOString() ?? null,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

/** Maps a failed create outcome to its Problem Details response. */
export function taskCreateFailureResponse(
  result: Extract<TaskCreateResult, { ok: false }>,
  correlationId: string,
): Response {
  switch (result.reason) {
    case "invalid":
      return validationProblem(correlationId, result.fieldErrors);
    case "conflict":
      return conflictProblem(correlationId, serializeTask(result.current));
    case "gone":
      return goneProblem(correlationId);
  }
}

/** Maps a failed update outcome to its Problem Details response. */
export function taskUpdateFailureResponse(
  result: Extract<TaskUpdateResult, { ok: false }>,
  correlationId: string,
): Response {
  switch (result.reason) {
    case "invalid":
      return validationProblem(correlationId, result.fieldErrors);
    case "conflict":
      return conflictProblem(correlationId, serializeTask(result.current));
    case "not_found":
      return notFoundProblem(correlationId, "This task no longer exists.");
    case "gone":
      return goneProblem(correlationId);
  }
}
