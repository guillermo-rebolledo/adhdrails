import { Temporal } from "temporal-polyfill";

/**
 * Pure agenda time math for the weekly Calendar. Every calculation works with
 * unambiguous instants (`Temporal.Instant`) and an explicit IANA time zone, so
 * a commitment keeps its wall-clock meaning across DST transitions and
 * traveling users. This module has no React, Next.js, Drizzle, or network
 * dependencies — it is shared by the client agenda, the server later-view, and
 * their tests. Display formatting lives in `./format`.
 */

/** New timed Events default to a 30-minute duration so common entry is fast. */
export const DEFAULT_EVENT_DURATION_MINUTES = 30;

/** A weekly agenda always shows seven days. */
export const WEEK_LENGTH_DAYS = 7;

/**
 * The agenda week starts on Monday (ISO-8601 weekday 1). The MVP is English-only
 * and a fixed, deterministic week start keeps the agenda predictable and easy to
 * test; locale still governs how days and times are *formatted*.
 */
export const WEEK_STARTS_ON = 1;

/** The smallest shape the agenda math needs from a timed Event. */
export interface TimedItem {
  id: string;
  /** The exact start instant as an ISO-8601 string with offset (e.g. `Z`). */
  startAt: string;
  /** The exact end instant as an ISO-8601 string. */
  endAt: string;
}

/** Half-open instant range `[startAt, endAt)` covering the agenda week. */
export interface WeekBounds {
  startAt: string;
  endAt: string;
}

/** One day column of the agenda: its local date and the Events that start in it. */
export interface AgendaDay<T extends TimedItem> {
  /** The local calendar date as `YYYY-MM-DD` in the agenda time zone. */
  date: string;
  events: T[];
}

function instant(iso: string): Temporal.Instant {
  return Temporal.Instant.from(iso);
}

/** Adds whole minutes to an instant, returning a new ISO-8601 instant string. */
export function addMinutesToInstant(iso: string, minutes: number): string {
  return instant(iso).add({ minutes }).toString();
}

/**
 * Combines a local calendar date (`YYYY-MM-DD`), wall-clock time (`HH:MM`), and
 * IANA time zone into the exact instant they denote, returned as an ISO-8601
 * string. This is how the Event creation form turns what a user typed into an
 * unambiguous instant. A time that does not exist because of a spring-forward
 * DST gap is disambiguated forward (Temporal's `compatible` default), so entry
 * never fails on a boundary.
 */
export function instantFromLocalParts(
  date: string,
  time: string,
  timeZone: string,
): string {
  return Temporal.PlainDateTime.from(`${date}T${time}`)
    .toZonedDateTime(timeZone)
    .toInstant()
    .toString();
}

/**
 * Whole minutes between two instants. Rounded to the nearest minute so a stored
 * pair always reports a clean duration. Independent of any time zone or DST.
 */
export function durationMinutesBetween(startAt: string, endAt: string): number {
  const seconds = instant(startAt)
    .until(instant(endAt), { largestUnit: "second" })
    .total({ unit: "second" });
  return Math.round(seconds / 60);
}

/** The local calendar date (`YYYY-MM-DD`) an instant falls on in `timeZone`. */
export function plainDateInZone(iso: string, timeZone: string): string {
  return instant(iso).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/**
 * Midnight (start of day) of the Monday beginning the week that contains
 * `reference`, expressed in `timeZone`. Returned as a `ZonedDateTime` so callers
 * can derive both the instant and the local date.
 */
function startOfWeekZoned(
  reference: string,
  timeZone: string,
): Temporal.ZonedDateTime {
  const day = instant(reference).toZonedDateTimeISO(timeZone).startOfDay();
  const delta =
    (day.dayOfWeek - WEEK_STARTS_ON + WEEK_LENGTH_DAYS) % WEEK_LENGTH_DAYS;
  return day.subtract({ days: delta });
}

/**
 * The half-open instant range covering the agenda week that contains
 * `reference`, in `timeZone`. `startAt` is Monday 00:00 local; `endAt` is the
 * following Monday 00:00 local. Using `startOfDay` (not a raw midnight
 * construction) keeps the bounds correct even when a week boundary lands on a
 * DST transition.
 */
export function weekBounds(reference: string, timeZone: string): WeekBounds {
  const start = startOfWeekZoned(reference, timeZone);
  const end = start.add({ days: WEEK_LENGTH_DAYS });
  return {
    startAt: start.toInstant().toString(),
    endAt: end.toInstant().toString(),
  };
}

/** The seven local dates (`YYYY-MM-DD`) of the agenda week, Monday first. */
export function weekDays(reference: string, timeZone: string): string[] {
  const start = startOfWeekZoned(reference, timeZone);
  return Array.from({ length: WEEK_LENGTH_DAYS }, (_, offset) =>
    start.add({ days: offset }).toPlainDate().toString(),
  );
}

/** Whether an instant falls inside the half-open week range `[startAt, endAt)`. */
export function isWithinWeek(iso: string, bounds: WeekBounds): boolean {
  const point = instant(iso).epochMilliseconds;
  return (
    point >= instant(bounds.startAt).epochMilliseconds &&
    point < instant(bounds.endAt).epochMilliseconds
  );
}

/** Whether an instant falls on or after the end of the agenda week (the Later window). */
export function isAfterWeek(iso: string, bounds: WeekBounds): boolean {
  return (
    instant(iso).epochMilliseconds >= instant(bounds.endAt).epochMilliseconds
  );
}

function byStartThenId(a: TimedItem, b: TimedItem): number {
  if (a.startAt !== b.startAt) {
    return a.startAt < b.startAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Buckets the given Events into the seven days of the agenda week that contains
 * `reference`, keyed by each Event's *start* in `timeZone`. Always returns seven
 * ordered day columns (empty ones included) so the agenda renders a stable grid;
 * Events outside the week are ignored (they belong to the Later list). Events
 * within a day are ordered by start instant, then id for a stable tie-break.
 */
export function groupEventsByDay<T extends TimedItem>(
  events: readonly T[],
  reference: string,
  timeZone: string,
): AgendaDay<T>[] {
  const bounds = weekBounds(reference, timeZone);
  const days = weekDays(reference, timeZone);
  const columns = new Map<string, T[]>(days.map((date) => [date, []]));

  for (const event of events) {
    if (!isWithinWeek(event.startAt, bounds)) {
      continue;
    }
    const date = plainDateInZone(event.startAt, timeZone);
    columns.get(date)?.push(event);
  }

  return days.map((date) => ({
    date,
    events: (columns.get(date) ?? []).slice().sort(byStartThenId),
  }));
}
