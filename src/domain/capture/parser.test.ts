import { describe, expect, it } from "vitest";

import { parseCapture, type ParseContext } from "./parser";

/**
 * A fixed Monday reference so every fixture is deterministic. 2026-07-27 is a
 * Monday; 09:00 local in America/Los_Angeles (PDT, UTC-7). chrono resolves
 * relative expressions ("tomorrow", "friday") against this instant, and the
 * adapter reads them back as wall-clock values in the reference zone.
 */
const MONDAY_9AM_PDT = "2026-07-27T09:00:00-07:00";

function context(overrides: Partial<ParseContext> = {}): ParseContext {
  return {
    reference: MONDAY_9AM_PDT,
    timeZone: "America/Los_Angeles",
    locale: "en-US",
    ...overrides,
  };
}

describe("parseCapture — dates and times", () => {
  it("detects a relative date and time and cleans the title", () => {
    const result = parseCapture("Call dentist tomorrow at 3pm", context());

    expect(result.hasSchedule).toBe(true);
    expect(result.cleanedTitle).toBe("Call dentist");
    expect(result.schedule.date).toBe("2026-07-28");
    expect(result.schedule.time).toBe("15:00");
    expect(result.chips.map((chip) => chip.kind)).toEqual(["date", "time"]);
  });

  it("detects a weekday-relative date", () => {
    const result = parseCapture("lunch with Sam friday noon", context());

    expect(result.cleanedTitle).toBe("lunch with Sam");
    expect(result.schedule.date).toBe("2026-07-31");
    expect(result.schedule.time).toBe("12:00");
  });

  it("treats a date without a specific time as date-only (no time chip)", () => {
    const result = parseCapture("submit report next monday", context());

    expect(result.schedule.date).toBe("2026-08-03");
    expect(result.schedule.time).toBeNull();
    expect(result.chips.some((chip) => chip.kind === "time")).toBe(false);
    expect(result.chips.some((chip) => chip.kind === "date")).toBe(true);
    expect(result.cleanedTitle).toBe("submit report");
  });

  it("detects a bare time and resolves it against the reference day", () => {
    const result = parseCapture("standup 9:30am", context());

    expect(result.schedule.time).toBe("09:30");
    // A time implies a day so the capture can become a tentative Event.
    expect(result.schedule.date).toBe("2026-07-27");
    // The date is only implied, so no editable date chip is shown.
    expect(result.chips.map((chip) => chip.kind)).toEqual(["time"]);
    expect(result.cleanedTitle).toBe("standup");
  });

  it("strips a trailing connective left behind after removing the match", () => {
    const result = parseCapture("submit report by next monday", context());

    expect(result.cleanedTitle).toBe("submit report");
  });
});

describe("parseCapture — durations", () => {
  it("detects an approximate duration without treating it as a time", () => {
    const result = parseCapture("review PR about 15 minutes", context());

    expect(result.schedule.durationMinutes).toBe(15);
    expect(result.schedule.time).toBeNull();
    expect(result.cleanedTitle).toBe("review PR");
    expect(result.chips.map((chip) => chip.kind)).toEqual(["duration"]);
  });

  it("detects a 'for N min' duration", () => {
    const result = parseCapture("gym for 45 min", context());

    expect(result.schedule.durationMinutes).toBe(45);
    expect(result.cleanedTitle).toBe("gym");
  });

  it("detects fractional hours", () => {
    const result = parseCapture("deep work for 1.5 hours", context());

    expect(result.schedule.durationMinutes).toBe(90);
  });

  it("detects word-form durations", () => {
    expect(
      parseCapture("nap half an hour", context()).schedule.durationMinutes,
    ).toBe(30);
    expect(
      parseCapture("call an hour", context()).schedule.durationMinutes,
    ).toBe(60);
  });

  it("keeps both a duration and a separate date/time", () => {
    const result = parseCapture(
      "workshop tomorrow at 2pm for 2 hours",
      context(),
    );

    expect(result.schedule.date).toBe("2026-07-28");
    expect(result.schedule.time).toBe("14:00");
    expect(result.schedule.durationMinutes).toBe(120);
    expect(result.cleanedTitle).toBe("workshop");
  });

  it("lets chrono own an 'in N hours' relative time rather than a duration", () => {
    const result = parseCapture("meeting in 2 hours", context());

    // "in 2 hours" is a point in time (11:00), not a duration.
    expect(result.schedule.durationMinutes).toBeNull();
    expect(result.schedule.time).toBe("11:00");
  });
});

describe("parseCapture — no match and false-positive avoidance", () => {
  it("reports no schedule for plain text", () => {
    const result = parseCapture("buy milk", context());

    expect(result.hasSchedule).toBe(false);
    expect(result.chips).toHaveLength(0);
    expect(result.schedule).toEqual({
      date: null,
      time: null,
      durationMinutes: null,
    });
    expect(result.cleanedTitle).toBe("buy milk");
  });

  it("does not treat a bare trailing number as a date", () => {
    const result = parseCapture("read chapter 5", context());

    expect(result.hasSchedule).toBe(false);
    expect(result.cleanedTitle).toBe("read chapter 5");
  });

  it("does not trigger on a month name used as a word", () => {
    const result = parseCapture("May the plan succeed", context());

    expect(result.hasSchedule).toBe(false);
    expect(result.cleanedTitle).toBe("May the plan succeed");
  });

  it("never returns an empty title, falling back to the original text", () => {
    const result = parseCapture("tomorrow at 3pm", context());

    expect(result.cleanedTitle).toBe("tomorrow at 3pm");
    expect(result.hasSchedule).toBe(true);
  });
});

describe("parseCapture — locale and timezone boundaries", () => {
  it("resolves relative dates in the account time zone, not UTC", () => {
    // 23:30 local in Los Angeles is already the next day in UTC. "tomorrow"
    // must mean the next LOCAL day, proving we read wall-clock components.
    const lateNight = "2026-07-27T23:30:00-07:00";
    const result = parseCapture(
      "ship it tomorrow",
      context({ reference: lateNight }),
    );

    expect(result.schedule.date).toBe("2026-07-28");
  });

  it("resolves the same instant differently across zones", () => {
    // The same instant is Tuesday morning in Tokyo but Monday evening in LA.
    const instant = "2026-07-28T02:00:00+09:00"; // Tue 02:00 JST
    const tokyo = parseCapture(
      "ship it tomorrow",
      context({ reference: instant, timeZone: "Asia/Tokyo" }),
    );

    expect(tokyo.schedule.date).toBe("2026-07-29");
  });

  it("formats chip labels in the requested locale", () => {
    const us = parseCapture("call at 3pm", context()).chips.find(
      (chip) => chip.kind === "time",
    );
    const gb = parseCapture(
      "call at 3pm",
      context({ locale: "en-GB" }),
    ).chips.find((chip) => chip.kind === "time");

    expect(us?.label).toBeTruthy();
    expect(gb?.label).toBeTruthy();
    // Both describe 15:00; the exact rendering may differ by locale.
    expect(us?.value).toBe("15:00");
    expect(gb?.value).toBe("15:00");
  });
});

describe("parseCapture — chip spans support correction", () => {
  it("exposes the original character span of each chip so it can be removed", () => {
    const text = "Call dentist tomorrow at 3pm";
    const result = parseCapture(text, context());

    for (const chip of result.chips) {
      expect(text.slice(chip.start, chip.end).length).toBeGreaterThan(0);
    }
    const dateChip = result.chips.find((chip) => chip.kind === "date");
    expect(dateChip).toBeDefined();
    expect(text.slice(dateChip!.start, dateChip!.end).toLowerCase()).toContain(
      "tomorrow",
    );
  });
});
