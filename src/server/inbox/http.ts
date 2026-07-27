import {
  type InboxItemResponse,
  inboxItemResponseSchema,
} from "@/domain/inbox/capture";
import {
  conflictProblem,
  goneProblem,
  notFoundProblem,
  validationProblem,
} from "@/server/http/problem";

import type { InboxItemRecord } from "./repository";
import type { InboxCaptureResult, InboxUpdateResult } from "./service";

export function serializeInboxItem(record: InboxItemRecord): InboxItemResponse {
  return inboxItemResponseSchema.parse({
    id: record.id,
    title: record.title,
    seen: record.seenAt !== null,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

/** Maps a failed capture outcome to its Problem Details response. */
export function inboxCaptureFailureResponse(
  result: Extract<InboxCaptureResult, { ok: false }>,
  correlationId: string,
): Response {
  switch (result.reason) {
    case "invalid":
      return validationProblem(correlationId, result.fieldErrors);
    case "conflict":
      return conflictProblem(correlationId, serializeInboxItem(result.current));
    case "gone":
      return goneProblem(correlationId);
  }
}

/** Maps a failed update outcome to its Problem Details response. */
export function inboxUpdateFailureResponse(
  result: Extract<InboxUpdateResult, { ok: false }>,
  correlationId: string,
): Response {
  switch (result.reason) {
    case "invalid":
      return validationProblem(correlationId, result.fieldErrors);
    case "conflict":
      return conflictProblem(correlationId, serializeInboxItem(result.current));
    case "not_found":
      return notFoundProblem(
        correlationId,
        "This inbox item no longer exists.",
      );
    case "gone":
      return goneProblem(correlationId);
  }
}
