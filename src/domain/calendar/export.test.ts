import { describe, expect, it } from "vitest";

import {
  buildGoogleEventWrite,
  isRecurringEvent,
  type ExportableEvent,
} from "./export";

function timedEvent(overrides: Partial<ExportableEvent> = {}): ExportableEvent {
  return {
    title: "Standup",
    startAt: "2026-07-27T13:00:00.000Z",
    endAt: "2026-07-27T13:30:00.000Z",
    startTimeZone: "America/New_York",
    endTimeZone: "America/New_York",
    status: "confirmed",
    isAllDay: false,
    recurringEventId: null,
    recurrence: null,
    ...overrides,
  };
}

describe("buildGoogleEventWrite", () => {
  it("translates a timed Event into a Google events body", () => {
    const result = buildGoogleEventWrite(timedEvent());

    expect(result).toEqual({
      ok: true,
      body: {
        summary: "Standup",
        start: {
          dateTime: "2026-07-27T13:00:00.000Z",
          timeZone: "America/New_York",
        },
        end: {
          dateTime: "2026-07-27T13:30:00.000Z",
          timeZone: "America/New_York",
        },
        status: "confirmed",
      },
    });
  });

  it("preserves distinct start and end time zones", () => {
    const result = buildGoogleEventWrite(
      timedEvent({
        startTimeZone: "America/New_York",
        endTimeZone: "America/Los_Angeles",
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.start.timeZone).toBe("America/New_York");
      expect(result.body.end.timeZone).toBe("America/Los_Angeles");
    }
  });

  it("refuses to write an all-day Event", () => {
    const result = buildGoogleEventWrite(timedEvent({ isAllDay: true }));
    expect(result).toEqual({ ok: false, reason: "all_day" });
  });

  it("refuses to write a recurring-series instance", () => {
    const result = buildGoogleEventWrite(
      timedEvent({ recurringEventId: "series-1" }),
    );
    expect(result).toEqual({ ok: false, reason: "recurring" });
  });

  it("refuses to write a recurring-series master", () => {
    const result = buildGoogleEventWrite(
      timedEvent({ recurrence: ["RRULE:FREQ=WEEKLY"] }),
    );
    expect(result).toEqual({ ok: false, reason: "recurring" });
  });
});

describe("isRecurringEvent", () => {
  it("is false for a one-off Event", () => {
    expect(isRecurringEvent({ recurringEventId: null, recurrence: null })).toBe(
      false,
    );
  });

  it("is false for an empty recurrence array", () => {
    expect(isRecurringEvent({ recurringEventId: null, recurrence: [] })).toBe(
      false,
    );
  });

  it("is true for a series instance", () => {
    expect(
      isRecurringEvent({ recurringEventId: "series-1", recurrence: null }),
    ).toBe(true);
  });

  it("is true for a series master", () => {
    expect(
      isRecurringEvent({
        recurringEventId: null,
        recurrence: ["RRULE:FREQ=DAILY"],
      }),
    ).toBe(true);
  });
});
