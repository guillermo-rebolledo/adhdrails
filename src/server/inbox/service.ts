import { z } from "zod";

import {
  inboxCaptureRequestSchema,
  resolveCreate,
} from "@/domain/inbox/capture";

import type { InboxItemRecord, InboxRepository } from "./repository";

export type InboxCaptureResult =
  | { ok: true; item: InboxItemRecord; created: boolean }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "conflict"; current: InboxItemRecord };

/**
 * Owns the Quick Capture use case: validate the mutation, resolve it against
 * whatever is already stored under the client-generated id, and report a
 * domain-level outcome. Idempotent retries return the stored record; a genuine
 * divergence returns a conflict so the client's local data is retained for
 * review rather than discarded. Route handlers translate the outcome to HTTP.
 */
export function createInboxService(repository: InboxRepository) {
  return {
    async capture(
      userId: string,
      rawInput: unknown,
    ): Promise<InboxCaptureResult> {
      const parsed = inboxCaptureRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }

      const input = parsed.data;
      const existing = await repository.getById(userId, input.id);
      const resolution = resolveCreate(existing, input);

      if (resolution === "conflict") {
        // `existing` is non-null whenever the resolution is a conflict.
        return { ok: false, reason: "conflict", current: existing! };
      }

      if (resolution === "replay") {
        return { ok: true, item: existing!, created: false };
      }

      const item = await repository.insert(userId, input);
      return { ok: true, item, created: true };
    },

    listForAccount(userId: string): Promise<InboxItemRecord[]> {
      return repository.listForAccount(userId);
    },
  };
}

export type InboxService = ReturnType<typeof createInboxService>;
