import { describe, expect, it } from "vitest";

import {
  formatDayHeading,
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

describe("formatMonthHeading", () => {
  it("renders a month and year label", () => {
    expect(formatMonthHeading("2026-07", "en-US")).toBe("July 2026");
    expect(formatMonthHeading("2026-11", "de-DE")).toBe("November 2026");
  });
});
