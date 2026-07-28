import { focusSessionResponseSchema } from "@/domain/focus/session";
import { apiRequest } from "@/lib/api-client";

import type { OutboxEntry } from "./db";
import type { SendResult } from "./sync";

export const FOCUS_SESSION_PATH = "/api/v1/focus-session";

/**
 * The default delivery for Focus Session outbox entries. It routes a start to
 * `POST /focus-session` and a transition to `PATCH /focus-session/:id`, and maps
 * the response to a {@link SendResult}: a 409 becomes a reviewable conflict (a
 * competing session started elsewhere, or a stale transition), and any other
 * non-2xx (or thrown network error) becomes a retryable failure so the entry
 * stays queued. There is no delete — completion is the session's terminal state.
 */
export function createFocusSessionSend(): (
  entry: OutboxEntry,
) => Promise<SendResult> {
  return async (entry) => {
    try {
      const path =
        entry.operation === "create"
          ? FOCUS_SESSION_PATH
          : `${FOCUS_SESSION_PATH}/${entry.entityId}`;
      const method = entry.operation === "create" ? "POST" : "PATCH";
      const response = await apiRequest<Record<string, unknown>>(path, {
        method,
        body: JSON.stringify(entry.payload),
      });

      if (response.ok) {
        return {
          ok: true,
          item: focusSessionResponseSchema.parse(response.body),
        };
      }

      if (response.status === 409 && response.body) {
        return {
          ok: false,
          kind: "conflict",
          current: focusSessionResponseSchema.parse(response.body.current),
        };
      }

      return { ok: false, kind: "retry", message: `status ${response.status}` };
    } catch (error) {
      return {
        ok: false,
        kind: "retry",
        message: error instanceof Error ? error.message : "network error",
      };
    }
  };
}
