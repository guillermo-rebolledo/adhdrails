import { taskResponseSchema } from "@/domain/task/task";
import { apiRequest } from "@/lib/api-client";

import type { OutboxEntry } from "./db";
import type { SendResult } from "./sync";

export const TASKS_PATH = "/api/v1/tasks";

/**
 * The default delivery for Task outbox entries. It routes each operation to the
 * versioned API — create to `POST /tasks`, update to `PATCH /tasks/:id`, delete
 * to `DELETE /tasks/:id` — and maps the response to a {@link SendResult}: a 409
 * becomes a reviewable conflict, a 410 means the Task was tombstoned and must
 * not be resurrected, and any other non-2xx (or thrown network error) becomes a
 * retryable failure so the entry stays queued.
 */
export function createTaskSend(): (entry: OutboxEntry) => Promise<SendResult> {
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
              : taskResponseSchema.parse(response.body),
        };
      }

      if (response.status === 409 && response.body) {
        return {
          ok: false,
          kind: "conflict",
          current: taskResponseSchema.parse(response.body.current),
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
    ? TASKS_PATH
    : `${TASKS_PATH}/${entry.entityId}`;
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
