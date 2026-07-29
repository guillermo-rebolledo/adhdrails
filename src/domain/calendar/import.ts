import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { isValidTimeZone } from "@/domain/account/onboarding";
import { type EventStatus, eventStatusSchema } from "@/domain/event/event";

/**
 * Pure rules for the bounded initial import of Google Calendar events into the
 * account-scoped mirror (MEM-40). This module knows how to size the mirror
 * window and how to translate a Google `events` resource into the mirror shape
 * Rails stores, preserving provider semantics — timed and all-day timing,
 * recurring-instance identity, cancellation, and time zones. It has no React,
 * Next.js, Drizzle, or network dependencies; the server layer performs the
 * paginated reads and persistence, and MEM-41 layers incremental sync on top.
 */

/** The default mirror reaches 30 days into the past. */
export const MIRROR_WINDOW_PAST_DAYS = 30;

/** The default mirror reaches 12 months into the future. */
export const MIRROR_WINDOW_FUTURE_MONTHS = 12;

/** Title shown for a Google event that has no summary of its own. */
export const UNTITLED_EVENT_TITLE = "(No title)";

/** The half-open instant range `[timeMin, timeMax)` a mirror import covers. */
export interface MirrorWindow {
  timeMin: string;
  timeMax: string;
}

/**
 * The mirror window anchored at `nowIso`: 30 days back through 12 months
 * forward. The past bound is computed in fixed hours (a wall-independent
 * duration); the future bound is computed as calendar months in UTC so it lands
 * on the same day-of-month a year out regardless of month lengths.
 */
export function mirrorWindow(nowIso: string): MirrorWindow {
  const now = Temporal.Instant.from(nowIso);
  return {
    timeMin: now.subtract({ hours: 24 * MIRROR_WINDOW_PAST_DAYS }).toString(),
    timeMax: now
      .toZonedDateTimeISO("UTC")
      .add({ months: MIRROR_WINDOW_FUTURE_MONTHS })
      .toInstant()
      .toString(),
  };
}

/**
 * The default mirror window stretched forward to reach `throughIso` when the user
 * browses past the default horizon (MEM-43 on-demand expansion). The past bound
 * and the whole default window are preserved — the future bound only ever
 * extends, never contracts — so expansion adds coverage without dropping any
 * current agenda data. A `throughIso` already inside the default window returns
 * the default window unchanged.
 */
export function expandedMirrorWindow(
  nowIso: string,
  throughIso: string,
): MirrorWindow {
  const base = mirrorWindow(nowIso);
  const through = Temporal.Instant.from(throughIso);
  const baseMax = Temporal.Instant.from(base.timeMax);
  return {
    timeMin: base.timeMin,
    timeMax:
      Temporal.Instant.compare(through, baseMax) > 0
        ? through.toString()
        : base.timeMax,
  };
}

const googleEventDateTimeSchema = z.object({
  /** RFC3339 with offset for a timed event; absent for an all-day event. */
  dateTime: z.string().optional(),
  /** `YYYY-MM-DD` for an all-day event; absent for a timed event. */
  date: z.string().optional(),
  /** IANA zone Google attaches to a timed event, when present. */
  timeZone: z.string().optional(),
});

/**
 * The subset of a Google Calendar `events` resource Rails mirrors. Parsed
 * defensively — unknown fields are ignored and most fields are optional because
 * a cancelled instance may carry almost nothing but its id and status.
 */
export const googleEventResourceSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  summary: z.string().optional(),
  start: googleEventDateTimeSchema.optional(),
  end: googleEventDateTimeSchema.optional(),
  recurringEventId: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  updated: z.string().optional(),
});

export type GoogleEventResource = z.infer<typeof googleEventResourceSchema>;

/** A Google event translated into the fields the mirror persists. */
export interface MirrorEvent {
  googleCalendarId: string;
  googleEventId: string;
  title: string;
  startAt: string;
  endAt: string;
  startTimeZone: string;
  endTimeZone: string;
  isAllDay: boolean;
  allDayStartDate: string | null;
  allDayEndDate: string | null;
  recurringEventId: string | null;
  recurrence: string[] | null;
  status: EventStatus;
}

/**
 * The outcome of translating one Google resource:
 * - `event` — a mappable commitment to upsert into the mirror.
 * - `cancelled` — Google reports the event as cancelled; any existing mirror
 *   row for its id should be removed rather than displayed.
 * - `skip` — the resource carries no usable timing and cannot be mirrored.
 */
export type MappedGoogleEvent =
  | { kind: "event"; event: MirrorEvent }
  | { kind: "cancelled"; googleEventId: string }
  | { kind: "skip"; googleEventId: string; reason: string };

export interface MapContext {
  googleCalendarId: string;
  /** The calendar's own time zone, used when an event does not carry one. */
  defaultTimeZone: string | null;
}

function resolveZone(candidate: string | undefined | null, fallback: string) {
  return candidate && isValidTimeZone(candidate) ? candidate : fallback;
}

function toStatus(raw: string | undefined): EventStatus {
  const parsed = eventStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : "confirmed";
}

/**
 * Translates one Google `events` resource into a {@link MappedGoogleEvent}.
 * Cancelled events short-circuit to a removal signal; a resource with neither a
 * `dateTime` nor a `date` start is skipped. Timed events keep their own instant
 * and time zone; all-day events keep their date bounds and are anchored to
 * midnight in the calendar's zone so they can still range-scan the agenda.
 */
export function mapGoogleEvent(
  resource: GoogleEventResource,
  context: MapContext,
): MappedGoogleEvent {
  const calendarZone = resolveZone(context.defaultTimeZone, "UTC");

  if (resource.status === "cancelled") {
    return { kind: "cancelled", googleEventId: resource.id };
  }

  const title = resource.summary?.trim() || UNTITLED_EVENT_TITLE;
  const base = {
    googleCalendarId: context.googleCalendarId,
    googleEventId: resource.id,
    title,
    recurringEventId: resource.recurringEventId ?? null,
    recurrence: resource.recurrence ?? null,
    status: toStatus(resource.status),
  };

  if (resource.start?.dateTime) {
    const startZone = resolveZone(resource.start.timeZone, calendarZone);
    const endZone = resolveZone(
      resource.end?.timeZone ?? resource.start.timeZone,
      startZone,
    );
    try {
      const startAt = Temporal.Instant.from(resource.start.dateTime).toString();
      const endAt = resource.end?.dateTime
        ? Temporal.Instant.from(resource.end.dateTime).toString()
        : startAt;
      return {
        kind: "event",
        event: {
          ...base,
          startAt,
          endAt,
          startTimeZone: startZone,
          endTimeZone: endZone,
          isAllDay: false,
          allDayStartDate: null,
          allDayEndDate: null,
        },
      };
    } catch {
      return {
        kind: "skip",
        googleEventId: resource.id,
        reason: "bad_instant",
      };
    }
  }

  if (resource.start?.date) {
    try {
      const startDate = resource.start.date;
      const endDate = resource.end?.date ?? startDate;
      const startAt = Temporal.PlainDate.from(startDate)
        .toZonedDateTime(calendarZone)
        .toInstant()
        .toString();
      const endAt = Temporal.PlainDate.from(endDate)
        .toZonedDateTime(calendarZone)
        .toInstant()
        .toString();
      return {
        kind: "event",
        event: {
          ...base,
          startAt,
          endAt,
          startTimeZone: calendarZone,
          endTimeZone: calendarZone,
          isAllDay: true,
          allDayStartDate: startDate,
          allDayEndDate: endDate,
        },
      };
    } catch {
      return { kind: "skip", googleEventId: resource.id, reason: "bad_date" };
    }
  }

  return { kind: "skip", googleEventId: resource.id, reason: "no_timing" };
}
