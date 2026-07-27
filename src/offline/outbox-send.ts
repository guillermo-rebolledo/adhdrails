import { thoughtResponseSchema } from "@/domain/thought/thought";
import { apiRequest } from "@/lib/api-client";

import type { OutboxEntry } from "./db";
import type { SendResult } from "./sync";

export function createThoughtSend(): (
  entry: OutboxEntry,
) => Promise<SendResult> {
  return async (entry) => {
    try {
      const path =
        entry.operation === "create"
          ? "/api/v1/thoughts"
          : `/api/v1/thoughts/${entry.entityId}`;
      const method =
        entry.operation === "create"
          ? "POST"
          : entry.operation === "update"
            ? "PATCH"
            : "DELETE";
      const response = await apiRequest<Record<string, unknown>>(path, {
        method,
        body: JSON.stringify(entry.payload),
      });
      if (response.ok) {
        return { ok: true, item: thoughtResponseSchema.parse(response.body) };
      }
      if (response.status === 409 && response.body) {
        return {
          ok: false,
          kind: "conflict",
          current: thoughtResponseSchema.parse(response.body.current),
        };
      }
      return {
        ok: false,
        kind: "retry",
        message: `status ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        kind: "retry",
        message: error instanceof Error ? error.message : "network error",
      };
    }
  };
}
