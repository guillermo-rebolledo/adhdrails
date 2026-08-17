import { Temporal } from "temporal-polyfill";

/**
 * Locale- and time-zone-aware display formatting for the Calendar. Interface
 * copy stays English, but dates and times follow the user's locale and are
 * always rendered in an explicit IANA time zone via `Intl`, so an imported
 * Event keeps the wall-clock meaning it was created with. Calculations live in
 * `./agenda` and `./later`; this module only formats.
 */

function dateFor(iso: string): Date {
  return new Date(Temporal.Instant.from(iso).epochMilliseconds);
}

/**
 * A single clock time for an instant, e.g. `9:00 AM` (en-US) or `15:00`
 * (de-DE), rendered in `timeZone`.
 */
export function formatTime(
  iso: string,
  timeZone: string,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(dateFor(iso));
}

/**
 * A start–end time range, e.g. `9:00 – 9:30 AM`, using `Intl.formatRange` so the
 * locale controls separators and shared AM/PM elision.
 */
export function formatTimeRange(
  startAt: string,
  endAt: string,
  timeZone: string,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).formatRange(dateFor(startAt), dateFor(endAt));
}

/**
 * A day-column heading for a local `YYYY-MM-DD` date, e.g. `Mon, Jul 20`. The
 * date is anchored to noon in `timeZone` so the formatted weekday and day never
 * slip across a boundary regardless of the zone's offset.
 */
export function formatDayHeading(
  plainDate: string,
  timeZone: string,
  locale: string,
): string {
  const zoned = Temporal.PlainDate.from(plainDate).toZonedDateTime({
    timeZone,
    plainTime: Temporal.PlainTime.from("12:00"),
  });
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(zoned.epochMilliseconds));
}

/** What an Event shows for its time in an agenda row or card. */
export interface EventTimeDisplay {
  /** The clock range in the *viewer's* time zone, e.g. `11:30 – 11:45 AM`. */
  range: string;
  /**
   * The original wall-clock start and zone — `3:30 PM America/Montevideo` —
   * present only when the Event was authored in a different zone than the one
   * being viewed. `null` otherwise.
   */
  original: string | null;
}

/**
 * The times an Event shows in the Calendar.
 *
 * The range is always rendered in `viewingTimeZone` — the account's zone. A
 * user reads their agenda as one continuous day, so every row must share one
 * clock: rendering each Event in its own zone made a 10:30 Panama meeting
 * appear *above* a 9:00 local one, because the sort is by instant while the
 * labels were not comparable. Day bucketing already uses the account zone, so
 * this also makes the time a row shows agree with the day it sits under.
 *
 * Nothing is lost in the conversion: when the Event's own zone differs, its
 * original wall-clock start is returned alongside, so a commitment made in
 * another zone can still be recognised by the time it was agreed in.
 *
 * Imported all-day Events carry instants for storage but have no meaningful
 * clock time, so they read "All day" with no original.
 */
export function formatEventTimes(input: {
  startAt: string;
  endAt: string;
  /** The Event's own start time zone. */
  timeZone: string;
  /** The zone the agenda is being read in — the account's zone. */
  viewingTimeZone: string;
  locale: string;
  isAllDay: boolean;
}): EventTimeDisplay {
  if (input.isAllDay) {
    return { range: "All day", original: null };
  }

  const range = formatTimeRange(
    input.startAt,
    input.endAt,
    input.viewingTimeZone,
    input.locale,
  );

  if (input.timeZone === input.viewingTimeZone) {
    return { range, original: null };
  }

  const originalStart = formatTime(input.startAt, input.timeZone, input.locale);
  return { range, original: `${originalStart} ${input.timeZone}` };
}

/** The separately formatted pieces of a day heading, for a stacked date label. */
export interface DayHeadingParts {
  /** Short weekday, e.g. `Mon`. */
  weekday: string;
  /** Day of the month, e.g. `20`. */
  day: string;
  /** Short month, e.g. `Jul`. */
  month: string;
}

/**
 * The same day heading as `formatDayHeading`, split into its parts so the
 * agenda can stack a date label — weekday over day-number over month — in a
 * narrow gutter. Each piece is formatted by `Intl` in `locale`, so a locale
 * that abbreviates differently still reads correctly; only the *arrangement*
 * is fixed. Anchored to noon in `timeZone` for the same reason as
 * `formatDayHeading`: no slipping across a day boundary.
 */
export function formatDayHeadingParts(
  plainDate: string,
  timeZone: string,
  locale: string,
): DayHeadingParts {
  const zoned = Temporal.PlainDate.from(plainDate).toZonedDateTime({
    timeZone,
    plainTime: Temporal.PlainTime.from("12:00"),
  });
  const date = new Date(zoned.epochMilliseconds);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(date);

  return {
    weekday: part({ weekday: "short" }),
    day: part({ day: "numeric" }),
    month: part({ month: "short" }),
  };
}

/** A month section heading for a `YYYY-MM` key, e.g. `July 2026`. */
export function formatMonthHeading(monthKey: string, locale: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  // Anchor to the first of the month at noon UTC and format in UTC, so the
  // label is a pure month/year with no zone sensitivity.
  const date = new Date(Date.UTC(year, month - 1, 1, 12));
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(date);
}
