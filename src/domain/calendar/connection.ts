import { z } from "zod";

import { isValidTimeZone } from "@/domain/account/onboarding";

/**
 * Pure Calendar-connection rules shared by the server, the API contracts, and
 * tests. No React, Next.js, Drizzle, or network dependencies — only `zod` and
 * other domain modules. This module owns the access-role vocabulary, the
 * writable-calendar invariants, and the request/response schemas for the
 * connect-and-configure flow (MEM-39). Token handling and Google I/O live in
 * the server layer.
 */

/** Google's `accessRole` values on a calendar list entry, most to least power. */
export const CALENDAR_ACCESS_ROLES = [
  "owner",
  "writer",
  "reader",
  "freeBusyReader",
] as const;

export type CalendarAccessRole = (typeof CALENDAR_ACCESS_ROLES)[number];

/** Only owner and writer roles may receive Rails-created Events. */
export function isWritableRole(role: CalendarAccessRole): boolean {
  return role === "owner" || role === "writer";
}

/** Connection lifecycle. A row exists only while Calendar access is granted. */
export const CONNECTION_STATUSES = ["connected"] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * Least-privilege Calendar scopes: read the user's calendars and their events
 * for the agenda mirror, and manage events on the one writable calendar. No
 * settings or sharing scopes are requested.
 */
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

const accessRoleSchema = z.enum(CALENDAR_ACCESS_ROLES);

/**
 * A calendar as returned by Google's calendar list, reduced to the fields Rails
 * stores and displays. `timeZone` is nullable because shared calendars may omit
 * it; the primary calendar always carries one and drives the timezone offer.
 */
export const availableCalendarSchema = z.object({
  googleCalendarId: z.string().min(1),
  summary: z.string().min(1),
  accessRole: accessRoleSchema,
  timeZone: z.string().nullable(),
  primary: z.boolean(),
});

export type AvailableCalendar = z.infer<typeof availableCalendarSchema>;

/** One line of a save-selection request: how the user wants a calendar treated. */
export const calendarSelectionEntrySchema = z.object({
  googleCalendarId: z.string().min(1),
  isVisible: z.boolean(),
  isWritable: z.boolean(),
});

export type CalendarSelectionEntry = z.infer<
  typeof calendarSelectionEntrySchema
>;

export const saveSelectionRequestSchema = z.object({
  selections: z.array(calendarSelectionEntrySchema),
});

export type SaveSelectionRequest = z.infer<typeof saveSelectionRequestSchema>;

/** A selected calendar as persisted and serialized back to the client. */
export const selectedCalendarSchema = availableCalendarSchema.extend({
  isVisible: z.boolean(),
  isWritable: z.boolean(),
});

export type SelectedCalendar = z.infer<typeof selectedCalendarSchema>;

export const connectionResponseSchema = z.object({
  status: z.enum(CONNECTION_STATUSES),
  primaryCalendarId: z.string().nullable(),
  primaryTimeZone: z.string().nullable(),
  connectedAt: z.string(),
  calendars: z.array(selectedCalendarSchema),
});

export type ConnectionResponse = z.infer<typeof connectionResponseSchema>;

export type SelectionValidation =
  | { ok: true }
  | {
      ok: false;
      reason: "unknown_calendar" | "multiple_writable" | "readonly_writable";
    };

/**
 * Validates a requested calendar selection against the calendars the account
 * actually has. Enforces the three hard rules of the writable choice: every
 * referenced calendar must exist, at most one calendar may be writable, and a
 * writable calendar must have a writable role — so a read-only shared calendar
 * can never become a write destination.
 */
export function validateSelection(
  available: readonly Pick<
    AvailableCalendar,
    "googleCalendarId" | "accessRole"
  >[],
  requested: readonly CalendarSelectionEntry[],
): SelectionValidation {
  const byId = new Map(available.map((c) => [c.googleCalendarId, c]));

  let writableCount = 0;
  for (const entry of requested) {
    const calendar = byId.get(entry.googleCalendarId);
    if (!calendar) {
      return { ok: false, reason: "unknown_calendar" };
    }
    if (entry.isWritable) {
      writableCount += 1;
      if (!isWritableRole(calendar.accessRole)) {
        return { ok: false, reason: "readonly_writable" };
      }
    }
  }

  if (writableCount > 1) {
    return { ok: false, reason: "multiple_writable" };
  }

  return { ok: true };
}

/**
 * The initial selection applied right after a grant: every calendar is visible,
 * and the primary calendar (or the first writable-role calendar if there is no
 * primary) becomes the single writable destination. A read-only-only account
 * gets no writable calendar, which is allowed.
 */
export function defaultSelection(
  available: readonly AvailableCalendar[],
): SelectedCalendar[] {
  const writableTarget =
    available.find((c) => c.primary && isWritableRole(c.accessRole)) ??
    available.find((c) => isWritableRole(c.accessRole));

  return available.map((calendar) => ({
    ...calendar,
    isVisible: true,
    isWritable: calendar.googleCalendarId === writableTarget?.googleCalendarId,
  }));
}

/** The primary calendar's timezone, when it is a usable IANA identifier. */
export function primaryTimeZoneOf(
  available: readonly AvailableCalendar[],
): string | null {
  const primary = available.find((c) => c.primary);
  if (primary?.timeZone && isValidTimeZone(primary.timeZone)) {
    return primary.timeZone;
  }
  return null;
}
