import { z } from "zod";
import { Temporal } from "temporal-polyfill";

import { isValidTimeZone } from "@/domain/account/onboarding";

/**
 * An Event is a time-bound commitment on the Calendar. In the MVP a user may
 * create *local* timed Events without Google Calendar access; imported Google
 * Events additionally carry all-day and recurrence identity, which this module
 * can represent even though local creation of those forms is deferred. Start and
 * end semantics mirror Google Calendar so synchronization needs no lossy
 * translation. This module is pure: it holds the shared contracts and resolution
 * logic used by the client outbox, the API routes, and their tests, with no
 * React, Next.js, Drizzle, or network dependencies.
 */

/** Longest Event title (summary) Rails will persist. */
export const EVENT_TITLE_MAX_LENGTH = 500;

/** Days an Event deletion tombstone is retained before it may be purged. */
export const EVENT_TOMBSTONE_RETENTION_DAYS = 30;

export const eventTitleSchema = z
  .string()
  .trim()
  .min(1, { message: "An event needs a title." })
  .max(EVENT_TITLE_MAX_LENGTH, { message: "This title is too long." });

/**
 * Event status mirrors Google Calendar's `status` field so a synchronized Event
 * round-trips without translation. Locally created Events are `confirmed`; a
 * timed capture awaiting type confirmation is represented as `tentative`.
 */
export const EVENT_STATUSES = ["confirmed", "tentative", "cancelled"] as const;
export const eventStatusSchema = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof eventStatusSchema>;

/**
 * Where an Event came from. `local` Events are authored in Rails without
 * Calendar access; `google` Events are mirrored from Google Calendar, which
 * remains authoritative for them. This drives the agenda's synchronized/local
 * distinction.
 */
export const EVENT_ORIGINS = ["local", "google"] as const;
export const eventOriginSchema = z.enum(EVENT_ORIGINS);
export type EventOrigin = z.infer<typeof eventOriginSchema>;

/** An IANA time zone identifier, validated so an Event never lands at a wrong instant. */
export const timeZoneSchema = z
  .string()
  .refine(isValidTimeZone, { message: "Unrecognized time zone." });

/** An exact instant as an ISO-8601 string with offset, parseable by Temporal. */
export const instantSchema = z.string().refine(
  (value) => {
    try {
      Temporal.Instant.from(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Not a valid instant." },
);

/**
 * Whether `endAt` is strictly after `startAt`. Defensive: an unparseable instant
 * returns `true` so the field-level {@link instantSchema} owns that error rather
 * than this cross-field check throwing during object refinement.
 */
function endsAfterStart(startAt: string, endAt: string): boolean {
  try {
    return (
      Temporal.Instant.compare(
        Temporal.Instant.from(endAt),
        Temporal.Instant.from(startAt),
      ) > 0
    );
  } catch {
    return true;
  }
}

/**
 * A single offline-capable create mutation for a local timed Event. The `id` is
 * a client-generated UUID so an offline record never needs temporary-ID
 * remapping, and `idempotencyKey` lets a retried delivery resolve to the same
 * server record. Start and end are unambiguous instants; the time zones preserve
 * the wall-clock intent for display. Local creation is timed only — all-day and
 * recurring Events arrive through import, never this path.
 */
export const eventCreateRequestSchema = z
  .object({
    id: z.uuid(),
    title: eventTitleSchema,
    startAt: instantSchema,
    endAt: instantSchema,
    startTimeZone: timeZoneSchema,
    endTimeZone: timeZoneSchema,
    idempotencyKey: z.uuid(),
  })
  .refine((event) => endsAfterStart(event.startAt, event.endAt), {
    message: "An event must end after it starts.",
    path: ["endAt"],
  });

export type EventCreateRequest = z.infer<typeof eventCreateRequestSchema>;

/** The mutable fields an update may carry. All optional; at least one required. */
export const eventPatchSchema = z
  .object({
    title: eventTitleSchema.optional(),
    startAt: instantSchema.optional(),
    endAt: instantSchema.optional(),
    startTimeZone: timeZoneSchema.optional(),
    endTimeZone: timeZoneSchema.optional(),
    status: eventStatusSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "An update needs at least one field.",
  })
  .refine(
    (patch) =>
      patch.startAt === undefined ||
      patch.endAt === undefined ||
      endsAfterStart(patch.startAt, patch.endAt),
    { message: "An event must end after it starts.", path: ["endAt"] },
  );

export type EventPatch = z.infer<typeof eventPatchSchema>;

/**
 * A single offline-capable update mutation. `baseVersion` is the server version
 * the client based this change on; a stale base is a conflict the server reports
 * so the local change is retained for review rather than clobbering newer data.
 */
export const eventUpdateRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  baseVersion: z.number().int().positive(),
  patch: eventPatchSchema,
});

export type EventUpdateRequest = z.infer<typeof eventUpdateRequestSchema>;

/**
 * Server-confirmed shape of an Event, shared by the serializer and the UI. It
 * mirrors Google-compatible fields — start/end instants and time zones, all-day
 * dates, recurrence identity, status, and provider identifiers — so an imported
 * Event and a local Event share one shape. `recurrence` holds RRULE lines for a
 * mirrored series; local Events never set it.
 */
export const eventResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  startTimeZone: z.string(),
  endTimeZone: z.string(),
  isAllDay: z.boolean(),
  allDayStartDate: z.string().nullable(),
  allDayEndDate: z.string().nullable(),
  recurringEventId: z.string().nullable(),
  recurrence: z.array(z.string()).nullable(),
  status: eventStatusSchema,
  origin: eventOriginSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type EventResponse = z.infer<typeof eventResponseSchema>;

/**
 * The identity-bearing content of an Event, compared to decide whether a
 * re-delivered create is a benign replay or a genuine conflict.
 */
export interface EventContent {
  title: string;
  startAt: string;
  endAt: string;
  startTimeZone: string;
  endTimeZone: string;
}

/** Whether two Events describe the same commitment (title, span, and zones). */
export function eventContentEquals(a: EventContent, b: EventContent): boolean {
  return (
    a.title === b.title &&
    Temporal.Instant.from(a.startAt).epochMilliseconds ===
      Temporal.Instant.from(b.startAt).epochMilliseconds &&
    Temporal.Instant.from(a.endAt).epochMilliseconds ===
      Temporal.Instant.from(b.endAt).epochMilliseconds &&
    a.startTimeZone === b.startTimeZone &&
    a.endTimeZone === b.endTimeZone
  );
}

/**
 * How an incoming create resolves against the stored world for its id:
 *
 * - `insert` — nothing exists yet; persist a fresh version 1 record.
 * - `replay` — a benign duplicate (same idempotency key, or identical content).
 * - `conflict` — the id exists with different content and a different
 *   idempotency key; retain both sides for review rather than overwriting.
 * - `gone` — the id was deleted and tombstoned; never resurrect it.
 */
export type CreateResolution = "insert" | "replay" | "conflict" | "gone";

export interface CreateState extends EventContent {
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
  return eventContentEquals(existing, incoming) ? "replay" : "conflict";
}

/**
 * How an incoming update resolves against the stored record:
 *
 * - `missing` — no such Event for this account; nothing to update.
 * - `gone` — the Event was deleted and tombstoned; the update is obsolete.
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
 * prevents another client from resurrecting an Event it deleted before the
 * deletion has propagated everywhere.
 */
export function eventTombstoneExpiresAt(deletedAt: Date): Date {
  const expires = new Date(deletedAt);
  expires.setUTCDate(expires.getUTCDate() + EVENT_TOMBSTONE_RETENTION_DAYS);
  return expires;
}
