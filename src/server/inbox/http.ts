import {
  type InboxItemResponse,
  inboxItemResponseSchema,
} from "@/domain/inbox/capture";
import { conflictProblem, validationProblem } from "@/server/http/problem";

import type { InboxItemRecord } from "./repository";
import type { InboxCaptureResult } from "./service";

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
  return result.reason === "invalid"
    ? validationProblem(correlationId, result.fieldErrors)
    : conflictProblem(correlationId, serializeInboxItem(result.current));
}
