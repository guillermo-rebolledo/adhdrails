import { z } from "zod";
import { Temporal } from "temporal-polyfill";

/**
 * A Task is the smallest unit of actionable work Rails owns. In the MVP a Task
 * requires only a title; everything else is optional planning metadata — a
 * Scheduled-for date with an optional time, an informational estimate, Energy,
 * an Important flag, notes, and at most one Area. This module holds the pure
 * contracts and resolution logic shared by the client outbox, the API routes,
 * and their tests — it has no React, Next.js, Drizzle, or network dependencies.
 */

/** Longest title a Task will persist. Generous, but bounded. */
export const TASK_TITLE_MAX_LENGTH = 500;

/** Longest free-text notes a Task will persist. */
export const TASK_NOTES_MAX_LENGTH = 5000;

/** Largest estimate a Task will persist, in minutes (24 hours). Informational only. */
export const TASK_ESTIMATE_MAX_MINUTES = 24 * 60;

/** Days an app-owned deletion tombstone is retained before it may be purged. */
export const TOMBSTONE_RETENTION_DAYS = 30;

export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, { message: "A task needs a title." })
  .max(TASK_TITLE_MAX_LENGTH, { message: "This title is too long." });

export const taskNotesSchema = z
  .string()
  .max(TASK_NOTES_MAX_LENGTH, { message: "These notes are too long." });

/**
 * Energy is optional capacity metadata. `low`, `medium`, and `high` let flexible
 * work be reordered to match how a user feels; an unset Energy is treated as
 * "Any" so a Task with no Energy is always eligible and never hidden. Energy is a
 * constrained `text` union persisted rather than a PostgreSQL enum, so it stays
 * easy to evolve.
 */
export const TASK_ENERGIES = ["low", "medium", "high"] as const;
export const taskEnergySchema = z.enum(TASK_ENERGIES);
export type TaskEnergy = z.infer<typeof taskEnergySchema>;

/**
 * The Energy a Task is effectively eligible for. An unset Energy resolves to
 * `any`, capturing the rule that missing metadata never hides work. Energy
 * reorders flexible Tasks but must never remove them, so this is the widest
 * possible eligibility, not a filter.
 */
export type EffectiveEnergy = TaskEnergy | "any";

export function resolveEffectiveEnergy(
  energy: TaskEnergy | null | undefined,
): EffectiveEnergy {
  return energy ?? "any";
}

/**
 * Whether a Task with the given Energy is eligible when the user's current
 * Energy is `current`. A Task without Energy (Any) is always eligible, and an
 * unset current Energy imposes no constraint — Energy may reorder flexible work
 * but never hides it.
 */
export function isEnergyEligible(
  taskEnergy: TaskEnergy | null | undefined,
  current: TaskEnergy | null | undefined,
): boolean {
  const effective = resolveEffectiveEnergy(taskEnergy);
  if (effective === "any" || !current) {
    return true;
  }
  return effective === current;
}

/**
 * A calendar date with no time-of-day, as `YYYY-MM-DD`. A date-only schedule
 * expresses "do it on this day" without implying a deadline or a specific time,
 * and — unlike a timed Task — never produces a timed browser reminder.
 */
export const scheduledDateSchema = z.string().refine(
  (value) => {
    try {
      return Temporal.PlainDate.from(value).toString() === value;
    } catch {
      return false;
    }
  },
  { message: "Not a valid date." },
);

/**
 * A wall-clock time of day as 24-hour `HH:MM`. It is only meaningful alongside a
 * scheduled date; a date with a time is a timed Task, a date alone is date-only.
 */
export const scheduledTimeSchema = z
  .string()
  .refine(
    (value) => /^\d{2}:\d{2}$/.test(value) && isValidWallClockTime(value),
    { message: "Not a valid time." },
  );

function isValidWallClockTime(value: string): boolean {
  try {
    Temporal.PlainTime.from(value);
    return true;
  } catch {
    return false;
  }
}

export const taskEstimateSchema = z
  .number()
  .int({ message: "An estimate is a whole number of minutes." })
  .positive({ message: "An estimate must be more than zero minutes." })
  .max(TASK_ESTIMATE_MAX_MINUTES, { message: "This estimate is too large." });

/** The scheduling shape shared by the schedule helpers below. */
export interface TaskSchedule {
  scheduledDate: string | null;
  scheduledTime: string | null;
}

/** A Task placed on a day with no specific time — never a timed reminder. */
export function isDateOnlySchedule(schedule: TaskSchedule): boolean {
  return schedule.scheduledDate !== null && schedule.scheduledTime === null;
}

/** A Task placed at a specific time on a day — eligible for a timed reminder. */
export function isTimedSchedule(schedule: TaskSchedule): boolean {
  return schedule.scheduledDate !== null && schedule.scheduledTime !== null;
}

/** A Task with no scheduled date; a time alone is not a schedule. */
export function isUnscheduled(schedule: TaskSchedule): boolean {
  return schedule.scheduledDate === null;
}

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
 * Whether a schedule is coherent: a time is only meaningful with a date. A time
 * without a date is rejected rather than silently dropped, so a timed intent is
 * never quietly downgraded to unscheduled. `null` for either side is fine.
 */
function scheduleIsCoherent(schedule: {
  scheduledDate?: string | null;
  scheduledTime?: string | null;
}): boolean {
  return !(schedule.scheduledTime != null && schedule.scheduledDate == null);
}

/**
 * The optional planning metadata a Task may carry, layered on top of its title.
 * Every field defaults to "not set": an omitted or `null` value means the Task
 * simply lacks that detail. `important` is a plain Boolean (not a priority
 * scale), and `estimateMinutes` is informational — never a deadline.
 */
const taskPlanningFields = {
  scheduledDate: scheduledDateSchema.nullable().optional(),
  scheduledTime: scheduledTimeSchema.nullable().optional(),
  estimateMinutes: taskEstimateSchema.nullable().optional(),
  energy: taskEnergySchema.nullable().optional(),
  important: z.boolean().optional(),
  notes: taskNotesSchema.optional(),
  areaId: z.uuid().nullable().optional(),
};

/**
 * A single offline-capable create mutation for a Task. The `id` is a
 * client-generated UUID so an offline record never needs temporary-ID
 * remapping, and `idempotencyKey` lets a retried delivery resolve to the same
 * server record instead of a duplicate. Only the title is required; the planning
 * metadata is optional, so title-only capture stays valid.
 */
export const taskCreateRequestSchema = z
  .object({
    id: z.uuid(),
    title: taskTitleSchema,
    idempotencyKey: z.uuid(),
    ...taskPlanningFields,
  })
  .refine(scheduleIsCoherent, {
    message: "A time needs a date.",
    path: ["scheduledTime"],
  });

export type TaskCreateRequest = z.infer<typeof taskCreateRequestSchema>;

/**
 * The mutable fields an update mutation may carry. All are optional; at least one
 * is required. Planning fields accept `null` to clear a previously set detail
 * (e.g. removing a schedule or an Area). The schedule coherence check only fires
 * when a patch would leave a time without a date within the same patch.
 */
export const taskPatchSchema = z
  .object({
    title: taskTitleSchema.optional(),
    status: taskStatusSchema.optional(),
    ...taskPlanningFields,
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "An update needs at least one field.",
  })
  .refine(
    // A patch that sets a time is only incoherent if it also *clears* the date in
    // the same patch. If the date is not part of the patch, the stored date may
    // still satisfy it, so the server applies it against the record.
    (patch) =>
      !(
        patch.scheduledTime != null &&
        "scheduledDate" in patch &&
        patch.scheduledDate == null
      ),
    { message: "A time needs a date.", path: ["scheduledTime"] },
  );

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
  scheduledDate: z.string().nullable(),
  scheduledTime: z.string().nullable(),
  estimateMinutes: z.number().int().positive().nullable(),
  energy: taskEnergySchema.nullable(),
  important: z.boolean(),
  notes: z.string(),
  areaId: z.uuid().nullable(),
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
