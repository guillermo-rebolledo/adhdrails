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
