import { describe, expect, it } from "vitest";

import { DEFAULT_EVENT_DURATION_MINUTES } from "@/domain/calendar/agenda";
import type { DetectedSchedule } from "@/domain/capture/parser";

import {
  calendarConsequenceFor,
  canConvertToEvent,
  conversionDraft,
} from "./classify";

const EMPTY: DetectedSchedule = {
  date: null,
  time: null,
  durationMinutes: null,
};

describe("calendarConsequenceFor", () => {
  it("explains the Calendar consequence with the default duration", () => {
    expect(calendarConsequenceFor("event")).toMatch(/calendar/i);
    expect(calendarConsequenceFor("event")).toContain(
      `${DEFAULT_EVENT_DURATION_MINUTES}-minute`,
    );
  });

  it("names the actual duration that will be created", () => {
    expect(calendarConsequenceFor("event", 15)).toContain("15-minute");
  });

  it("has no consequence for Task or Thought conversions", () => {
    expect(calendarConsequenceFor("task")).toBeNull();
    expect(calendarConsequenceFor("thought")).toBeNull();
  });
});

describe("canConvertToEvent", () => {
  it("requires both a date and a time", () => {
    expect(
      canConvertToEvent({ ...EMPTY, date: "2026-07-28", time: "09:00" }),
    ).toBe(true);
    expect(canConvertToEvent({ ...EMPTY, date: "2026-07-28" })).toBe(false);
    expect(canConvertToEvent({ ...EMPTY, time: "09:00" })).toBe(false);
    expect(canConvertToEvent(EMPTY)).toBe(false);
  });
});

describe("conversionDraft", () => {
  it("preserves the cleaned title and detected schedule", () => {
    const draft = conversionDraft(
      "Call the dentist",
      "Call the dentist tomorrow at 9am",
      {
        date: "2026-07-28",
        time: "09:00",
        durationMinutes: 45,
      },
    );

    expect(draft).toEqual({
      title: "Call the dentist",
      date: "2026-07-28",
      time: "09:00",
      durationMinutes: 45,
    });
  });

  it("falls back to the raw title and default duration", () => {
    const draft = conversionDraft("   ", "9am", EMPTY);

    expect(draft.title).toBe("9am");
    expect(draft.durationMinutes).toBe(DEFAULT_EVENT_DURATION_MINUTES);
  });
});
