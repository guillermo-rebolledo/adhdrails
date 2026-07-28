import { type EventStatus } from "@/domain/event/event";

/**
 * Pure rules for the outbound direction of Calendar synchronization (MEM-42):
 * translating a Rails Event into the Google Calendar `events` write body, and
 * deciding which Events may be written at all. This is the inverse of the
 * import's {@link import("./import").mapGoogleEvent}. It has no React, Next.js,
 * Drizzle, or network dependencies; the server layer performs the actual
 * `events.insert`/`patch`/`delete` calls and the mirror write-back.
 *
 * The MVP only ever writes *timed* Events. All-day creation is deferred and
 * recurring-series edits route the user to Google, so this module refuses to
 * build a body for either form — a defensive backstop behind the UI guards and
 * the service-level checks.
 */

/** How an outbound Event mutation reaches Google. */
export const EVENT_EXPORT_OPERATIONS = ["upsert", "delete"] as const;
export type EventExportOperation = (typeof EVENT_EXPORT_OPERATIONS)[number];

/** The fields of a stored Event this module reasons about. */
export interface ExportableEvent {
  title: string;
  startAt: string;
  endAt: string;
  startTimeZone: string;
  endTimeZone: string;
  status: EventStatus;
  isAllDay: boolean;
  recurringEventId: string | null;
  recurrence: string[] | null;
}

/** A Google `events` start/end object for a timed Event. */
export interface GoogleEventDateTime {
  dateTime: string;
  timeZone: string;
}

/**
 * The request body Rails sends to `events.insert`/`events.patch`. Only the
 * fields Rails owns are sent: an insert or patch that omits everything else
 * leaves Google's other fields untouched, so a patch never clobbers attendees,
 * reminders, or description that Google alone manages.
 */
export interface GoogleEventWriteBody {
  summary: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  status?: EventStatus;
}

/**
 * Whether an Event carries recurrence identity — it is an instance of a series
 * (`recurringEventId`) or itself a series master (`recurrence`). Recurring-series
 * edits are routed to Google in the MVP rather than partially implemented, so
 * callers use this to refuse an outbound write and steer the user to Google.
 */
export function isRecurringEvent(event: {
  recurringEventId: string | null;
  recurrence: string[] | null;
}): boolean {
  return (
    event.recurringEventId !== null ||
    (event.recurrence !== null && event.recurrence.length > 0)
  );
}

/**
 * Why a Rails Event cannot be written to Google:
 * - `all_day` — all-day creation is deferred; only timed Events are written.
 * - `recurring` — series edits route to Google instead of being written here.
 */
export type ExportBlockReason = "all_day" | "recurring";

/**
 * Translates a stored Event into a Google `events` write body, or reports why it
 * cannot be written. Timed Events map their instants and IANA zones directly —
 * Google-compatible start/end semantics mean no lossy translation. All-day and
 * recurring Events are blocked here as a backstop behind the UI and service
 * guards.
 */
export function buildGoogleEventWrite(
  event: ExportableEvent,
):
  | { ok: true; body: GoogleEventWriteBody }
  | { ok: false; reason: ExportBlockReason } {
  if (event.isAllDay) {
    return { ok: false, reason: "all_day" };
  }
  if (isRecurringEvent(event)) {
    return { ok: false, reason: "recurring" };
  }

  return {
    ok: true,
    body: {
      summary: event.title,
      start: { dateTime: event.startAt, timeZone: event.startTimeZone },
      end: { dateTime: event.endAt, timeZone: event.endTimeZone },
      status: event.status,
    },
  };
}
