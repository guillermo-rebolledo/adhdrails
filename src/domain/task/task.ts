import { z } from "zod";

/**
 * A Task is the smallest unit of actionable work Rails owns. In the MVP a Task
 * requires only a title; planning metadata (schedule, energy, estimate, Area,
 * Important) arrives in later slices. This module holds the pure contracts and
 * resolution logic shared by the client outbox, the API routes, and their
 * tests — it has no React, Next.js, Drizzle, or network dependencies.
 */

/** Longest title a Task will persist. Generous, but bounded. */
export const TASK_TITLE_MAX_LENGTH = 500;

/** Days an app-owned deletion tombstone is retained before it may be purged. */
export const TOMBSTONE_RETENTION_DAYS = 30;

export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, { message: "A task needs a title." })
  .max(TASK_TITLE_MAX_LENGTH, { message: "This title is too long." });

/**
 * Task status is a constrained set persisted as a `text` column and mirrored by
 * this union rather than a PostgreSQL enum, so states stay easy to evolve.
 * There is no punitive "overdue" state — reaching an estimate never changes a
 * Task's status.
 */
export const TASK_STATUSES = ["active", "completed"] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/**
 * A single offline-capable create mutation for a Task. The `id` is a
 * client-generated UUID so an offline record never needs temporary-ID
 * remapping, and `idempotencyKey` lets a retried delivery resolve to the same
 * server record instead of a duplicate.
 */
export const taskCreateRequestSchema = z.object({
  id: z.uuid(),
  title: taskTitleSchema,
  idempotencyKey: z.uuid(),
});

export type TaskCreateRequest = z.infer<typeof taskCreateRequestSchema>;

/** The mutable fields an update mutation may carry. All are optional. */
export const taskPatchSchema = z
  .object({
    title: taskTitleSchema.optional(),
    status: taskStatusSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "An update needs at least one field.",
  });

export type TaskPatch = z.infer<typeof taskPatchSchema>;

/**
 * A single offline-capable update mutation. `baseVersion` is the server version
 * the client based this change on; a stale base is a conflict the server
 * reports so the local change can be retained for review rather than
 * clobbering newer data.
 */
export const taskUpdateRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  baseVersion: z.number().int().positive(),
  patch: taskPatchSchema,
});

export type TaskUpdateRequest = z.infer<typeof taskUpdateRequestSchema>;

/** Server-confirmed shape of a Task, shared by the serializer and the UI. */
export const taskResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: taskStatusSchema,
  completedAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TaskResponse = z.infer<typeof taskResponseSchema>;

/**
 * How an incoming create resolves against the stored world for its id:
 *
 * - `insert` — nothing exists yet; persist a fresh version 1 record.
 * - `replay` — a benign duplicate delivery (same idempotency key, or identical
 *   title); return the stored record without writing again.
 * - `conflict` — the id exists with different content and a different
 *   idempotency key; retain both sides for review rather than overwriting.
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
 * - `missing` — no such Task for this account; nothing to update.
 * - `gone` — the Task was deleted and tombstoned; the update is obsolete.
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
 * The calm acknowledgement shown when a Task is completed. Deliberately free of
 * scores, streaks, or "well done!" pressure — it simply confirms and offers a
 * way back.
 */
export const TASK_COMPLETED_MESSAGE =
  "Task complete. Nicely done — take a breath.";

/**
 * Resolves the completion timestamp for a status change, shared by the API
 * service and the client outbox so both apply identical rules: set it when a
 * Task first becomes completed, clear it when it returns to active, and leave
 * it untouched when the status is not part of the change. Generic over the
 * timestamp representation (a `Date` on the server, an ISO string on the
 * client). Completion never produces a punitive or overdue state.
 */
export function resolveCompletedAt<T>(
  current: T | null,
  nextStatus: TaskStatus | undefined,
  now: T,
): T | null {
  if (nextStatus === undefined) {
    return current;
  }
  return nextStatus === "completed" ? (current ?? now) : null;
}

/**
 * The instant a tombstone written at `deletedAt` may be purged. Retention
 * prevents another client from resurrecting an app-owned record it deleted
 * before the deletion has propagated everywhere.
 */
export function tombstoneExpiresAt(deletedAt: Date): Date {
  const expires = new Date(deletedAt);
  expires.setUTCDate(expires.getUTCDate() + TOMBSTONE_RETENTION_DAYS);
  return expires;
}

/** Whether a tombstone written at `deletedAt` is safe to purge by `now`. */
export function isTombstoneExpired(deletedAt: Date, now: Date): boolean {
  return now.getTime() >= tombstoneExpiresAt(deletedAt).getTime();
}
