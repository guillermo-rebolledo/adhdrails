import { inboxItemResponseSchema } from "@/domain/inbox/capture";
import { apiRequest } from "@/lib/api-client";

import type { OutboxEntry } from "./db";
import type { SendResult } from "./sync";

export const INBOX_ITEMS_PATH = "/api/v1/inbox-items";

/**
 * The default delivery for Inbox outbox entries. It routes each operation to the
 * versioned API — create to `POST /inbox-items`, update to
 * `PATCH /inbox-items/:id`, delete to `DELETE /inbox-items/:id` — and maps the
 * response to a {@link SendResult}: a 409 becomes a reviewable conflict, a 410
 * means the item was tombstoned and must not be resurrected, and any other
 * non-2xx (or thrown network error) becomes a retryable failure so the entry
 * stays queued.
 */
export function createInboxSend(): (entry: OutboxEntry) => Promise<SendResult> {
  return async (entry) => {
    try {
      const response = await apiRequest<Record<string, unknown>>(
        requestPath(entry),
        requestInit(entry),
      );

      if (response.ok) {
        return {
          ok: true,
          item:
            entry.operation === "delete"
              ? undefined
              : inboxItemResponseSchema.parse(response.body),
        };
      }

      if (response.status === 409 && response.body) {
        return {
          ok: false,
          kind: "conflict",
          current: inboxItemResponseSchema.parse(response.body.current),
        };
      }

      if (response.status === 410) {
        return { ok: false, kind: "gone" };
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

function requestPath(entry: OutboxEntry): string {
  return entry.operation === "create"
    ? INBOX_ITEMS_PATH
    : `${INBOX_ITEMS_PATH}/${entry.entityId}`;
}

function requestInit(entry: OutboxEntry): RequestInit {
  switch (entry.operation) {
    case "create":
      return { method: "POST", body: JSON.stringify(entry.payload) };
    case "update":
      return { method: "PATCH", body: JSON.stringify(entry.payload) };
    case "delete":
      return { method: "DELETE" };
  }
}
