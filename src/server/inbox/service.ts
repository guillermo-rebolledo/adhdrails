import { z } from "zod";

import {
  inboxCaptureRequestSchema,
  inboxUpdateRequestSchema,
  resolveCreate,
  resolveUpdate,
} from "@/domain/inbox/capture";

import type { InboxItemRecord, InboxRepository } from "./repository";

export type InboxCaptureResult =
  | { ok: true; item: InboxItemRecord; created: boolean }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "conflict"; current: InboxItemRecord }
  | { ok: false; reason: "gone" };

export type InboxUpdateResult =
  | { ok: true; item: InboxItemRecord; applied: boolean }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "conflict"; current: InboxItemRecord }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "gone" };

/**
 * Owns the Quick Capture use case: validate the mutation, resolve it against
 * whatever is already stored under the client-generated id, and report a
 * domain-level outcome. Idempotent retries return the stored record; a genuine
 * divergence returns a conflict so the client's local data is retained for
 * review rather than discarded. Route handlers translate the outcome to HTTP.
 */
export function createInboxService(
  repository: InboxRepository,
  now: () => Date = () => new Date(),
) {
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
      const tombstoned = await repository.isTombstoned(userId, input.id);
      const existing = await repository.getById(userId, input.id);
      const resolution = resolveCreate(existing, input, tombstoned);

      if (resolution === "gone") {
        return { ok: false, reason: "gone" };
      }

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

    async update(
      userId: string,
      id: string,
      rawInput: unknown,
    ): Promise<InboxUpdateResult> {
      const parsed = inboxUpdateRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }

      const input = parsed.data;
      const tombstoned = await repository.isTombstoned(userId, id);
      const existing = await repository.getById(userId, id);
      const resolution = resolveUpdate(existing, input, tombstoned);

      if (resolution === "gone") {
        return { ok: false, reason: "gone" };
      }
      if (resolution === "missing") {
        return { ok: false, reason: "not_found" };
      }
      if (resolution === "conflict") {
        return { ok: false, reason: "conflict", current: existing! };
      }
      if (resolution === "replay") {
        return { ok: true, item: existing!, applied: false };
      }

      // `seen` is monotonic: setting it true stamps `seenAt` once and a later
      // update never clears it. `seen: false` is a no-op on the timestamp.
      const seenAt =
        input.patch.seen === true
          ? (existing!.seenAt ?? now())
          : existing!.seenAt;

      const item = await repository.update(userId, id, {
        patch: input.patch,
        seenAt,
        version: existing!.version + 1,
        idempotencyKey: input.idempotencyKey,
      });
      return { ok: true, item, applied: true };
    },

    /** Deletes an Inbox Item and writes its tombstone. Idempotent by construction. */
    async remove(userId: string, id: string): Promise<void> {
      await repository.remove(userId, id);
    },

    listForAccount(userId: string): Promise<InboxItemRecord[]> {
      return repository.listForAccount(userId);
    },
  };
}

export type InboxService = ReturnType<typeof createInboxService>;
