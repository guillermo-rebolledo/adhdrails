import { z } from "zod";

/**
 * An Area is a lightweight, optional label a Task can carry for context. In the
 * MVP a Task may have at most one Area, and Areas are created on entry from the
 * Task form's combobox rather than managed in a dedicated screen. This module
 * holds the pure contracts and resolution logic shared by the client outbox, the
 * API routes, and their tests — it has no React, Next.js, Drizzle, or network
 * dependencies.
 */

/** Longest Area name Rails will persist. Generous, but bounded. */
export const AREA_NAME_MAX_LENGTH = 100;

export const areaNameSchema = z
  .string()
  .trim()
  .min(1, { message: "An area needs a name." })
  .max(AREA_NAME_MAX_LENGTH, { message: "This name is too long." });

/**
 * Case- and whitespace-insensitive key used to decide whether two Area names
 * describe the same Area. The combobox uses it to reuse an existing Area instead
 * of creating a duplicate (e.g. "Work" and "  work  " are the same Area).
 */
export function normalizeAreaName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** Whether two Area names refer to the same Area, ignoring case and surrounding space. */
export function areaNamesMatch(a: string, b: string): boolean {
  return normalizeAreaName(a) === normalizeAreaName(b);
}

/**
 * A single offline-capable create mutation for an Area. The `id` is a
 * client-generated UUID so an offline record never needs temporary-ID remapping,
 * and `idempotencyKey` lets a retried delivery resolve to the same server record
 * instead of a duplicate. Areas are create-and-select only in the MVP; there is
 * no rename or delete path, so no tombstone is needed.
 */
export const areaCreateRequestSchema = z.object({
  id: z.uuid(),
  name: areaNameSchema,
  idempotencyKey: z.uuid(),
});

export type AreaCreateRequest = z.infer<typeof areaCreateRequestSchema>;

/** Server-confirmed shape of an Area, shared by the serializer and the UI. */
export const areaResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AreaResponse = z.infer<typeof areaResponseSchema>;

/**
 * How an incoming create resolves against the stored world for its id:
 *
 * - `insert` — nothing exists yet; persist a fresh version 1 record.
 * - `replay` — a benign duplicate delivery (same idempotency key, or an Area
 *   with the same normalized name already exists for this id); return the stored
 *   record without writing again.
 * - `conflict` — the id exists with a different name and a different idempotency
 *   key; retain both sides for review rather than overwriting.
 *
 * Areas have no deletion path, so there is no `gone` outcome.
 */
export type CreateResolution = "insert" | "replay" | "conflict";

/** The identity-bearing fields `resolveCreate` compares on both sides. */
export interface CreateState {
  name: string;
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
  return areaNamesMatch(existing.name, incoming.name) ? "replay" : "conflict";
}
