import { inboxItemResponseSchema } from "@/domain/inbox/capture";
import { apiRequest } from "@/lib/api-client";

import type { OutboxEntry } from "./db";
import type { SendResult } from "./sync";

export const INBOX_ITEMS_PATH = "/api/v1/inbox-items";

/**
 * The default delivery for Inbox outbox entries. It posts the mutation to the
 * versioned API and maps the response to a {@link SendResult}: a 409 becomes a
 * reviewable conflict, any other non-2xx (and any thrown network error) becomes
 * a retryable failure so the entry stays queued.
 */
export function createInboxSend(): (entry: OutboxEntry) => Promise<SendResult> {
  return async (entry) => {
    try {
      const response = await apiRequest<Record<string, unknown>>(
        INBOX_ITEMS_PATH,
        { method: "POST", body: JSON.stringify(entry.payload) },
      );

      if (response.ok) {
        return { ok: true, item: inboxItemResponseSchema.parse(response.body) };
      }

      if (response.status === 409 && response.body) {
        return {
          ok: false,
          kind: "conflict",
          current: inboxItemResponseSchema.parse(response.body.current),
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
