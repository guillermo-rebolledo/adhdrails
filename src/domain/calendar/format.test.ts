import { describe, expect, it } from "vitest";

import {
  formatDayHeading,
  formatDayHeadingParts,
  formatEventTimes,
  formatMonthHeading,
  formatTime,
  formatTimeRange,
} from "./format";

const NY = "America/New_York";
const BERLIN = "Europe/Berlin";

/**
 * ICU renders locale-specific separators — narrow/no-break spaces around AM/PM
 * and thin spaces in ranges — that are invisible but not the ASCII characters a
 * test literal contains. Normalizing those code points to a regular space keeps
 * assertions about the *shape* of the output stable across ICU versions.
 */
function normalize(value: string): string {
  return value.replace(/[\u00A0\u2009\u202F]/g, " ");
}

describe("formatTime", () => {
  it("renders a clock time in the given zone and locale", () => {
    // 13:00Z is 09:00 in New York (EDT).
    expect(normalize(formatTime("2026-07-20T13:00:00Z", NY, "en-US"))).toBe(
      "9:00 AM",
    );
    // Same instant, Berlin, 24-hour German formatting -> 15:00.
    expect(formatTime("2026-07-20T13:00:00Z", BERLIN, "de-DE")).toBe("15:00");
  });
});

describe("formatTimeRange", () => {
  it("renders a locale-aware start–end range", () => {
    expect(
      normalize(
        formatTimeRange(
          "2026-07-20T13:00:00Z",
          "2026-07-20T13:30:00Z",
          NY,
          "en-US",
        ),
      ),
    ).toBe("9:00 – 9:30 AM");
  });
});

describe("formatDayHeading", () => {
  it("renders a weekday and date without slipping across the zone boundary", () => {
    expect(formatDayHeading("2026-07-20", NY, "en-US")).toBe("Mon, Jul 20");
  });
});

describe("formatEventTimes", () => {
  const base = {
    startAt: "2026-07-20T13:00:00Z",
    endAt: "2026-07-20T13:30:00Z",
    locale: "en-US",
    isAllDay: false,
  };

  it("renders the range in the viewer's zone, not the event's", () => {
    // Authored as 3:00 PM in Berlin; the viewer in New York reads 9:00 AM.
    const display = formatEventTimes({
      ...base,
      timeZone: BERLIN,
      viewingTimeZone: NY,
    });
    expect(normalize(display.range)).toBe("9:00 – 9:30 AM");
  });

  it("notes the original wall-clock start when the zones differ", () => {
    const display = formatEventTimes({
      ...base,
      timeZone: BERLIN,
      viewingTimeZone: NY,
    });
    expect(normalize(display.original ?? "")).toBe("3:00 PM Europe/Berlin");
  });

  it("omits the original when the event was authored in the viewer's zone", () => {
    const display = formatEventTimes({
      ...base,
      timeZone: NY,
      viewingTimeZone: NY,
    });
    expect(display.original).toBeNull();
  });

  it("orders two events by the same clock a user actually reads", () => {
    // 08:30 in New York and 09:00 in New York, the latter authored in Berlin.
    const earlier = formatEventTimes({
      ...base,
      startAt: "2026-07-20T12:30:00Z",
      endAt: "2026-07-20T13:00:00Z",
      timeZone: NY,
      viewingTimeZone: NY,
    });
    const later = formatEventTimes({
      ...base,
      timeZone: BERLIN,
      viewingTimeZone: NY,
    });
    // Both read on the New York clock, so the earlier instant reads earlier —
    // the confusion that made a foreign-zone event look out of order is gone.
    expect(normalize(earlier.range)).toBe("8:30 – 9:00 AM");
    expect(normalize(later.range)).toBe("9:00 – 9:30 AM");
  });

  it("renders an all-day event as 'All day' with no original", () => {
    const display = formatEventTimes({
      ...base,
      timeZone: BERLIN,
      viewingTimeZone: NY,
      isAllDay: true,
    });
    expect(display).toEqual({ range: "All day", original: null });
  });
});

describe("formatDayHeadingParts", () => {
  it("splits the heading into weekday, day, and month", () => {
    expect(formatDayHeadingParts("2026-07-20", NY, "en-US")).toEqual({
      weekday: "Mon",
      day: "20",
      month: "Jul",
    });
  });

  it("follows the locale for each piece", () => {
    const parts = formatDayHeadingParts("2026-07-20", BERLIN, "de-DE");
    expect(parts.day).toBe("20");
    expect(parts.weekday).toBe("Mo");
  });

  it("does not slip across the zone boundary", () => {
    // Anchored at noon, so a far-eastern zone still reports the same date.
    expect(
      formatDayHeadingParts("2026-07-20", "Pacific/Kiritimati", "en-US"),
    ).toMatchObject({ day: "20", month: "Jul" });
  });
});

describe("formatMonthHeading", () => {
  it("renders a month and year label", () => {
    expect(formatMonthHeading("2026-07", "en-US")).toBe("July 2026");
    expect(formatMonthHeading("2026-11", "de-DE")).toBe("November 2026");
  });
});
