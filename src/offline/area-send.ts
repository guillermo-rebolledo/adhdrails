import { areaResponseSchema } from "@/domain/area/area";
import { apiRequest } from "@/lib/api-client";

import type { OutboxEntry } from "./db";
import type { SendResult } from "./sync";

export const AREAS_PATH = "/api/v1/areas";

/**
 * The delivery for Area outbox entries. Areas are create-only in the MVP, so the
 * only operation is `POST /areas`. A 409 becomes a reviewable conflict; any other
 * non-2xx (or a thrown network error) becomes a retryable failure so the entry
 * stays queued for the next drain.
 */
export function createAreaSend(): (entry: OutboxEntry) => Promise<SendResult> {
  return async (entry) => {
    try {
      const response = await apiRequest<Record<string, unknown>>(AREAS_PATH, {
        method: "POST",
        body: JSON.stringify(entry.payload),
      });

      if (response.ok) {
        return { ok: true, item: areaResponseSchema.parse(response.body) };
      }

      if (response.status === 409 && response.body) {
        return {
          ok: false,
          kind: "conflict",
          current: areaResponseSchema.parse(response.body.current),
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
