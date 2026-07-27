import * as chrono from "chrono-node";
import { Temporal } from "temporal-polyfill";

/**
 * Quick Capture's conservative, deterministic natural-language parser. It turns
 * capture text into *proposed* schedule details — a date, a time, and a
 * duration — that the user confirms or corrects before anything is finalized.
 * The parser is intentionally cautious: it prefers reporting "no schedule" to
 * guessing, so an uncertain capture is always retained safely in the Inbox.
 *
 * `chrono-node` recognizes dates and times; a small custom pass recognizes
 * durations such as "about 15 minutes" before chrono runs, so a duration is
 * never misread as a point in time. This module is pure — it holds the contracts
 * and logic shared by the capture UI and their tests, with no React, Next.js,
 * Drizzle, or network dependencies. Formatting a chip label is locale-aware, but
 * the interface language is always English.
 */

export type ChipKind = "date" | "time" | "duration";

/**
 * One detected schedule value, shown as an editable/removable chip before
 * classification. `start`/`end` are the character span in the *original* capture
 * text so the UI can highlight or strip it; `value` is the machine form and
 * `label` the locale-formatted display form.
 */
export interface CaptureChip {
  kind: ChipKind;
  label: string;
  value: string;
  start: number;
  end: number;
}

export interface DetectedSchedule {
  /** Local calendar date (`YYYY-MM-DD`) in the reference zone, or null. */
  date: string | null;
  /** Wall-clock time (`HH:MM`) when a specific time was detected, else null. */
  time: string | null;
  /** Detected duration in whole minutes, or null. */
  durationMinutes: number | null;
}

export interface ParseResult {
  /**
   * The capture text with recognized schedule spans removed and trailing
   * connectives cleaned up. Never empty — falls back to the original text when
   * the whole capture was schedule.
   */
  cleanedTitle: string;
  schedule: DetectedSchedule;
  chips: CaptureChip[];
  /** True when at least one date, time, or duration was detected. */
  hasSchedule: boolean;
}

export interface ParseContext {
  /** Reference instant (ISO-8601 with offset) the parse is relative to. */
  reference: string;
  /** IANA time zone the capture's wall-clock values belong to. */
  timeZone: string;
  /** Formatting locale for chip labels. Defaults to `en-US`. */
  locale?: string;
}

const EMPTY_SCHEDULE: DetectedSchedule = {
  date: null,
  time: null,
  durationMinutes: null,
};

/**
 * Prepositions that, when they immediately precede a "N unit" phrase, mark it as
 * a point in time ("in 2 hours", "at 3") rather than a duration. chrono owns
 * those; the duration pass steps aside.
 */
const TEMPORAL_PREPOSITIONS = new Set([
  "in",
  "at",
  "by",
  "before",
  "after",
  "until",
  "till",
  "around",
  "on",
]);

/** Connective words stripped from a title edge left bare by a removed span. */
const EDGE_CONNECTIVES = new Set([
  "at",
  "on",
  "by",
  "for",
  "from",
  "due",
  "starting",
  "this",
  "next",
  "in",
  "to",
  "until",
  "till",
  "@",
  "~",
  "about",
  "around",
  "approximately",
  "approx",
  "roughly",
]);

interface Span {
  start: number;
  end: number;
}

interface DurationMatch extends Span {
  minutes: number;
}

const HOUR_UNIT = /^(?:h|hr|hrs|hour|hours)$/i;

function unitToMinutes(value: number, unit: string): number {
  return HOUR_UNIT.test(unit) ? Math.round(value * 60) : Math.round(value);
}

/**
 * Whether the match starting at `index` is immediately preceded by a temporal
 * preposition, in which case it is a point in time and not a duration.
 */
function precededByPreposition(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  const word = before.slice(before.lastIndexOf(" ") + 1).toLowerCase();
  return TEMPORAL_PREPOSITIONS.has(word);
}

const WORD_DURATIONS: { pattern: RegExp; minutes: number }[] = [
  { pattern: /\b(?:a\s+)?quarter\s+(?:of\s+an\s+)?hour\b/i, minutes: 15 },
  { pattern: /\bhalf\s+(?:an?\s+)?hour\b/i, minutes: 30 },
  { pattern: /\b(?:an|one)\s+hour\b/i, minutes: 60 },
];

// A qualifier ("for", "about", "~"…) makes a "N unit" phrase unambiguously a
// duration; without one, a bare "N unit" is still a duration unless a temporal
// preposition claims it first.
const QUALIFIED_DURATION =
  /(?:for|about|approx\.?|approximately|roughly|~)\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/gi;
const BARE_DURATION = /\b(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h)\b/gi;

/**
 * Finds the first duration in `text`, preferring word forms and qualified forms
 * over a bare "N unit". Returns its span and minutes, or null. Conservative by
 * design: a bare phrase claimed by a temporal preposition ("in 2 hours") is left
 * for chrono to read as a time.
 */
function detectDuration(text: string): DurationMatch | null {
  const candidates: DurationMatch[] = [];

  for (const { pattern, minutes } of WORD_DURATIONS) {
    const match = pattern.exec(text);
    if (match && !precededByPreposition(text, match.index)) {
      candidates.push({
        start: match.index,
        end: match.index + match[0].length,
        minutes,
      });
    }
  }

  for (const regex of [QUALIFIED_DURATION, BARE_DURATION]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (regex === BARE_DURATION && precededByPreposition(text, match.index)) {
        continue;
      }
      candidates.push({
        start: match.index,
        end: match.index + match[0].length,
        minutes: unitToMinutes(Number(match[1]), match[2]),
      });
      break; // First match per pattern is enough.
    }
  }

  if (candidates.length === 0) {
    return null;
  }
  // Earliest span wins; a word/qualified form at the same position beats a bare
  // one because it was pushed first.
  return candidates.sort((a, b) => a.start - b.start)[0];
}

/** Replaces a span with equal-length spaces so downstream indices still align. */
function blank(text: string, span: Span): string {
  return (
    text.slice(0, span.start) +
    " ".repeat(span.end - span.start) +
    text.slice(span.end)
  );
}

/** The reference's UTC offset in whole minutes, which chrono reads as its zone. */
function offsetMinutes(reference: string, timeZone: string): number {
  const zoned = Temporal.Instant.from(reference).toZonedDateTimeISO(timeZone);
  return zoned.offsetNanoseconds / 60_000_000_000;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDate(
  year: number,
  month: number,
  day: number,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatTime(hour: number, minute: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(1970, 0, 1, hour, minute)));
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
}

/**
 * Removes every recognized span from the original text and tidies the edges left
 * behind — a preposition like "by" or "at" that only made sense with the removed
 * schedule is dropped too. Falls back to the original text if cleaning would
 * leave nothing, so a capture always keeps a title.
 */
function cleanTitle(original: string, spans: Span[]): string {
  if (spans.length === 0) {
    return original.trim();
  }

  const expanded = spans.map((span) => {
    const before = original.slice(0, span.start).trimEnd();
    const word = before.slice(before.lastIndexOf(" ") + 1);
    const start = EDGE_CONNECTIVES.has(word.toLowerCase())
      ? before.length - word.length
      : span.start;
    return { start, end: span.end };
  });

  let masked = original;
  for (const span of expanded) {
    masked = blank(masked, span);
  }

  const cleaned = masked.replace(/\s+/g, " ").trim();
  return cleaned === "" ? original.trim() : cleaned;
}

/**
 * Parses a Quick Capture string into proposed, correctable schedule details.
 * Durations are extracted first and masked so chrono cannot mistake them for
 * times; chrono then reads a single date/time from what remains. A detected time
 * always carries an implied day so the capture can become a tentative Event,
 * while a date without a certain hour stays date-only (no timed reminder).
 */
export function parseCapture(text: string, context: ParseContext): ParseResult {
  const locale = context.locale ?? "en-US";
  const spans: Span[] = [];
  const chips: CaptureChip[] = [];

  const duration = detectDuration(text);
  const forChrono = duration ? blank(text, duration) : text;

  const [chronoResult] = chrono.casual.parse(
    forChrono,
    {
      instant: new Date(context.reference),
      timezone: offsetMinutes(context.reference, context.timeZone),
    },
    { forwardDate: true },
  );

  let date: string | null = null;
  let time: string | null = null;

  if (chronoResult) {
    const { start } = chronoResult;
    const hasDate =
      start.isCertain("day") ||
      start.isCertain("weekday") ||
      start.isCertain("month");
    const hasTime = start.isCertain("hour");

    if (hasDate || hasTime) {
      const year = start.get("year");
      const month = start.get("month");
      const day = start.get("day");
      const hour = start.get("hour") ?? 0;
      const minute = start.get("minute") ?? 0;

      if (year != null && month != null && day != null) {
        date = `${year}-${pad(month)}-${pad(day)}`;
      }
      const span: Span = {
        start: chronoResult.index,
        end: chronoResult.index + chronoResult.text.length,
      };
      spans.push(span);

      if (hasDate && date) {
        chips.push({
          kind: "date",
          label: formatDate(year!, month!, day!, locale),
          value: date,
          ...span,
        });
      }
      if (hasTime) {
        time = `${pad(hour)}:${pad(minute)}`;
        chips.push({
          kind: "time",
          label: formatTime(hour, minute, locale),
          value: time,
          ...span,
        });
      }
    }
  }

  if (duration) {
    spans.push(duration);
    chips.push({
      kind: "duration",
      label: formatDuration(duration.minutes),
      value: String(duration.minutes),
      start: duration.start,
      end: duration.end,
    });
  }

  chips.sort((a, b) => a.start - b.start);

  const schedule: DetectedSchedule =
    chips.length === 0
      ? EMPTY_SCHEDULE
      : { date, time, durationMinutes: duration?.minutes ?? null };

  return {
    cleanedTitle: cleanTitle(text, spans),
    schedule,
    chips,
    hasSchedule: chips.length > 0,
  };
}
