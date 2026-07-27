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
 * How an incoming create resolves against whatever is already stored under the
 * same client-generated id:
 *
 * - `insert` — nothing exists yet; persist a fresh version 1 record.
 * - `replay` — a benign duplicate delivery (same idempotency key, or identical
 *   content); return the stored record without writing again.
 * - `conflict` — the id exists with different content and a different
 *   idempotency key; the local change is retained for review rather than
 *   silently overwriting the server, and vice versa.
 */
export type CreateResolution = "insert" | "replay" | "conflict";

/** The identity-bearing fields `resolveCreate` compares on both sides. */
export interface CreateState {
  title: string;
  idempotencyKey: string;
}

export function resolveCreate(
  existing: CreateState | null,
  incoming: CreateState,
): CreateResolution {
  if (existing === null) {
    return "insert";
  }

  if (existing.idempotencyKey === incoming.idempotencyKey) {
    return "replay";
  }

  return existing.title === incoming.title ? "replay" : "conflict";
}
