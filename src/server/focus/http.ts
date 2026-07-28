import {
  type FocusSessionResponse,
  focusSessionResponseSchema,
  focusSessionStatusSchema,
} from "@/domain/focus/session";
import {
  conflictProblem,
  notFoundProblem,
  validationProblem,
} from "@/server/http/problem";

import type { FocusSessionRecord } from "./repository";
import type { FocusStartResult, FocusTransitionResult } from "./service";

export function serializeFocusSession(
  record: FocusSessionRecord,
): FocusSessionResponse {
  return focusSessionResponseSchema.parse({
    id: record.id,
    taskId: record.taskId,
    status: focusSessionStatusSchema.parse(record.status),
    accumulatedSeconds: record.accumulatedSeconds,
    lastResumedAt: record.lastResumedAt?.toISOString() ?? null,
    distractionCount: record.distractionCount,
    startedAt: record.startedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

/** Maps a failed start outcome to its Problem Details response. */
export function focusStartFailureResponse(
  result: Extract<FocusStartResult, { ok: false }>,
  correlationId: string,
): Response {
  switch (result.reason) {
    case "invalid":
      return validationProblem(correlationId, result.fieldErrors);
    case "conflict":
      return conflictProblem(
        correlationId,
        serializeFocusSession(result.current),
      );
  }
}

/** Maps a failed transition outcome to its Problem Details response. */
export function focusTransitionFailureResponse(
  result: Extract<FocusTransitionResult, { ok: false }>,
  correlationId: string,
): Response {
  switch (result.reason) {
    case "invalid":
      return validationProblem(correlationId, result.fieldErrors);
    case "not_found":
      return notFoundProblem(
        correlationId,
        "This focus session no longer exists.",
      );
    case "conflict":
      return conflictProblem(
        correlationId,
        serializeFocusSession(result.current),
      );
  }
}
