import { DEFAULT_EVENT_DURATION_MINUTES } from "@/domain/calendar/agenda";
import type { DetectedSchedule } from "@/domain/capture/parser";

/**
 * Processing an Inbox Item converts it into one of the three supported types. A
 * conversion preserves whatever fields the destination can hold and, when the
 * destination touches the Calendar, explains that consequence before it occurs.
 * This module is pure — it holds the conversion rules shared by the processing
 * UI and their tests, with no React, Next.js, Drizzle, or network dependencies.
 */

/** The types an Inbox Item can be classified into during processing. */
export const INBOX_TARGET_TYPES = ["task", "event", "thought"] as const;
export type InboxTargetType = (typeof INBOX_TARGET_TYPES)[number];

/**
 * The explicit consequence of a conversion, surfaced to the user *before* it
 * happens. Only converting to an Event has an external consequence in the MVP —
 * it places the item on the Calendar — so every other target returns null and
 * needs no confirmation step. The message names the actual duration that will be
 * created (the detected duration, or the default), so what the user confirms
 * matches what occurs.
 */
export function calendarConsequenceFor(
  target: InboxTargetType,
  durationMinutes: number = DEFAULT_EVENT_DURATION_MINUTES,
): string | null {
  return target === "event"
    ? `This will be added to your calendar as a ${durationMinutes}-minute event.`
    : null;
}

/**
 * Whether the detected schedule is complete enough to become an Event without
 * further input. A local Event is timed, so it needs both a calendar date and a
 * wall-clock time; a bare date (no certain hour) stays a date-only capture and
 * cannot be confirmed as an Event inline.
 */
export function canConvertToEvent(schedule: DetectedSchedule): boolean {
  return schedule.date !== null && schedule.time !== null;
}

/**
 * The compatible fields carried from a processed capture into its destination.
 * The cleaned title (schedule words stripped) is preserved for every type; the
 * detected date, time, and duration are preserved for an Event. A Task and a
 * Thought keep only the title in the MVP, so their schedule is dropped — a
 * non-Calendar consequence the UI can still surface as prefilled chips.
 */
export interface ConversionDraft {
  title: string;
  date: string | null;
  time: string | null;
  durationMinutes: number;
}

export function conversionDraft(
  cleanedTitle: string,
  rawTitle: string,
  schedule: DetectedSchedule,
): ConversionDraft {
  const title = cleanedTitle.trim() || rawTitle.trim();
  return {
    title,
    date: schedule.date,
    time: schedule.time,
    durationMinutes: schedule.durationMinutes ?? DEFAULT_EVENT_DURATION_MINUTES,
  };
}
