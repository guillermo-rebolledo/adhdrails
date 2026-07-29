import {
  type ThoughtResponse,
  thoughtResponseSchema,
} from "@/domain/thought/thought";
import {
  conflictProblem,
  problemResponse,
  validationProblem,
} from "@/server/http/problem";

import type { ThoughtRecord } from "./repository";
import type { ThoughtResult } from "./service";

export function serializeThought(record: ThoughtRecord): ThoughtResponse {
  return thoughtResponseSchema.parse({
    id: record.id,
    title: record.title,
    body: record.body,
    sourceInboxItemId: record.sourceInboxItemId,
    version: record.version,
    deletedAt: record.deletedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

export function thoughtFailureResponse(
  result: Exclude<ThoughtResult, { ok: true }>,
  correlationId: string,
): Response {
  if (result.reason === "invalid") {
    return validationProblem(correlationId, result.fieldErrors);
  }
  if (result.reason === "conflict") {
    return conflictProblem(correlationId, serializeThought(result.current));
  }
  return problemResponse({
    type: "https://rails.app/problems/not-found",
    title: "Not found",
    status: 404,
    code: "not_found",
    detail: "That Thought is no longer available.",
    correlationId,
    retryable: false,
  });
}
