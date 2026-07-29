import { z } from "zod";

/**
 * The Inbox is where captured, still-unclassified material waits without
 * pressure. Quick Capture writes a title-only Inbox Item; classification into a
 * Task, Thought, or Event happens later. This module holds the pure contracts
 * and version logic shared by the client outbox, the API route, and their
 * tests — it has no React, Next.js, Drizzle, or network dependencies.
 */

/** Longest title Quick Capture will persist. Generous, but bounded. */
export const INBOX_TITLE_MAX_LENGTH = 500;

/** Days an app-owned Inbox Item deletion tombstone is retained before purge. */
export const INBOX_TOMBSTONE_RETENTION_DAYS = 30;

export const inboxTitleSchema = z
  .string()
  .trim()
  .min(1, { message: "A capture needs a title." })
  .max(INBOX_TITLE_MAX_LENGTH, { message: "This capture is too long." });

/**
 * A single offline-capable create mutation for an Inbox Item. The `id` is a
 * client-generated UUID so an offline record never needs temporary-ID
 * remapping, and `idempotencyKey` lets a retried delivery resolve to the same
 * server record instead of a duplicate.
 */
export const inboxCaptureRequestSchema = z.object({
  id: z.uuid(),
  title: inboxTitleSchema,
  idempotencyKey: z.uuid(),
});

export type InboxCaptureRequest = z.infer<typeof inboxCaptureRequestSchema>;

/** Server-confirmed shape of an Inbox Item, shared by the serializer and UI. */
export const inboxItemResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  seen: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type InboxItemResponse = z.infer<typeof inboxItemResponseSchema>;

/**
 * The only field an Inbox Item update mutates in the MVP: marking it seen when
 * the Inbox is opened. `seen` is monotonic — it only ever moves from false to
 * true — but the patch shape leaves room for future fields.
 */
export const inboxPatchSchema = z
  .object({ seen: z.boolean().optional() })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "An update needs at least one field.",
  });

export type InboxPatch = z.infer<typeof inboxPatchSchema>;

/**
 * A single offline-capable update mutation. `baseVersion` is the server version
 * the client based this change on; a stale base is a conflict the server reports
 * so the local change is retained for review rather than clobbering newer data.
 */
export const inboxUpdateRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  baseVersion: z.number().int().positive(),
  patch: inboxPatchSchema,
});

export type InboxUpdateRequest = z.infer<typeof inboxUpdateRequestSchema>;

/**
 * How an incoming create resolves against whatever is already stored under the
 * same client-generated id:
 *
 * - `insert` — nothing exists yet; persist a fresh version 1 record.
 * - `replay` — a benign duplicate delivery (same idempotency key, or identical
 *   content); return the stored record without writing again.
 * - `conflict` — the id exists with different content and a different
 *   idempotency key; the local change is retained for review rather than
 *   silently overwriting the server, and vice versa.
 * - `gone` — the id was deleted and tombstoned; never resurrect it.
 */
export type CreateResolution = "insert" | "replay" | "conflict" | "gone";

/** The identity-bearing fields `resolveCreate` compares on both sides. */
export interface CreateState {
  title: string;
  idempotencyKey: string;
}

export function resolveCreate(
  existing: CreateState | null,
  incoming: CreateState,
  tombstoned = false,
): CreateResolution {
  if (tombstoned) {
    return "gone";
  }

  if (existing === null) {
    return "insert";
  }

  if (existing.idempotencyKey === incoming.idempotencyKey) {
    return "replay";
  }

  return existing.title === incoming.title ? "replay" : "conflict";
}

/**
 * How an incoming update resolves against the stored record:
 *
 * - `missing` — no such Inbox Item for this account; nothing to update.
 * - `gone` — the item was deleted and tombstoned; the update is obsolete.
 * - `replay` — this exact mutation was already applied (same idempotency key).
 * - `apply` — the base version matches; apply the patch and bump the version.
 * - `conflict` — the base version is stale; retain the local change for review.
 */
export type UpdateResolution =
  | "missing"
  | "gone"
  | "replay"
  | "apply"
  | "conflict";

/** The fields `resolveUpdate` compares on the stored record. */
export interface UpdateState {
  version: number;
  idempotencyKey: string;
}

export function resolveUpdate(
  existing: UpdateState | null,
  incoming: { baseVersion: number; idempotencyKey: string },
  tombstoned = false,
): UpdateResolution {
  if (tombstoned) {
    return "gone";
  }

  if (existing === null) {
    return "missing";
  }

  if (existing.idempotencyKey === incoming.idempotencyKey) {
    return "replay";
  }

  return existing.version === incoming.baseVersion ? "apply" : "conflict";
}

/**
 * The instant a tombstone written at `deletedAt` may be purged. Retention
 * prevents another client from resurrecting an app-owned Inbox Item it deleted
 * before the deletion has propagated everywhere.
 */
export function inboxTombstoneExpiresAt(deletedAt: Date): Date {
  const expires = new Date(deletedAt);
  expires.setUTCDate(expires.getUTCDate() + INBOX_TOMBSTONE_RETENTION_DAYS);
  return expires;
}

/** Whether a tombstone written at `deletedAt` is safe to purge by `now`. */
export function isInboxTombstoneExpired(deletedAt: Date, now: Date): boolean {
  return now.getTime() >= inboxTombstoneExpiresAt(deletedAt).getTime();
}
