import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import {
  MIRROR_WINDOW_FUTURE_MONTHS,
  MIRROR_WINDOW_PAST_DAYS,
  type GoogleEventResource,
  mapGoogleEvent,
  mirrorWindow,
} from "./import";

const CONTEXT = {
  googleCalendarId: "primary@example.com",
  defaultTimeZone: "America/New_York",
};

function mapped(resource: GoogleEventResource, context = CONTEXT) {
  const result = mapGoogleEvent(resource, context);
  if (result.kind !== "event") {
    throw new Error(`expected an event, got ${result.kind}`);
  }
  return result.event;
}

describe("mirrorWindow", () => {
  it("spans 30 days past through 12 months future from now", () => {
    const now = "2026-07-27T12:00:00.000Z";
    const window = mirrorWindow(now);

    const expectedMin = Temporal.Instant.from(now)
      .subtract({ hours: 24 * MIRROR_WINDOW_PAST_DAYS })
      .toString();
    const expectedMax = Temporal.Instant.from(now)
      .toZonedDateTimeISO("UTC")
      .add({ months: MIRROR_WINDOW_FUTURE_MONTHS })
      .toInstant()
      .toString();

    expect(window.timeMin).toBe(expectedMin);
    expect(window.timeMax).toBe(expectedMax);
    expect(
      Temporal.Instant.compare(
        Temporal.Instant.from(window.timeMin),
        Temporal.Instant.from(window.timeMax),
      ),
    ).toBe(-1);
  });
});

describe("mapGoogleEvent — timed", () => {
  it("maps a timed event to instants and preserves its own time zone", () => {
    const event = mapped({
      id: "evt-timed",
      status: "confirmed",
      summary: "Standup",
      start: {
        dateTime: "2026-07-27T09:00:00-04:00",
        timeZone: "America/New_York",
      },
      end: {
        dateTime: "2026-07-27T09:30:00-04:00",
        timeZone: "America/New_York",
      },
    });

    expect(event).toMatchObject({
      googleCalendarId: "primary@example.com",
      googleEventId: "evt-timed",
      title: "Standup",
      isAllDay: false,
      allDayStartDate: null,
      allDayEndDate: null,
      recurringEventId: null,
      status: "confirmed",
      startTimeZone: "America/New_York",
      endTimeZone: "America/New_York",
    });
    expect(Temporal.Instant.from(event.startAt).epochMilliseconds).toBe(
      Temporal.Instant.from("2026-07-27T13:00:00Z").epochMilliseconds,
    );
    expect(Temporal.Instant.from(event.endAt).epochMilliseconds).toBe(
      Temporal.Instant.from("2026-07-27T13:30:00Z").epochMilliseconds,
    );
  });

  it("falls back to the calendar time zone when the event omits one", () => {
    const event = mapped({
      id: "evt-notz",
      summary: "Call",
      start: { dateTime: "2026-07-27T09:00:00-04:00" },
      end: { dateTime: "2026-07-27T10:00:00-04:00" },
    });

    expect(event.startTimeZone).toBe("America/New_York");
    expect(event.endTimeZone).toBe("America/New_York");
  });

  it("falls back to UTC when the calendar has no usable time zone", () => {
    const event = mapped(
      {
        id: "evt-shared",
        summary: "Shared",
        start: { dateTime: "2026-07-27T09:00:00Z" },
        end: { dateTime: "2026-07-27T10:00:00Z" },
      },
      {
        googleCalendarId: "shared@group.calendar.google.com",
        defaultTimeZone: "Not/AZone",
      },
    );

    expect(event.startTimeZone).toBe("UTC");
  });
});

describe("mapGoogleEvent — all-day", () => {
  it("maps an all-day event with date bounds and midnight instants", () => {
    const event = mapped({
      id: "evt-allday",
      summary: "Holiday",
      start: { date: "2026-12-25" },
      end: { date: "2026-12-26" },
    });

    expect(event).toMatchObject({
      isAllDay: true,
      allDayStartDate: "2026-12-25",
      allDayEndDate: "2026-12-26",
      startTimeZone: "America/New_York",
    });
    // Midnight on Dec 25 in New York is 05:00Z (EST).
    expect(Temporal.Instant.from(event.startAt).epochMilliseconds).toBe(
      Temporal.Instant.from("2026-12-25T05:00:00Z").epochMilliseconds,
    );
    expect(Temporal.Instant.from(event.endAt).epochMilliseconds).toBe(
      Temporal.Instant.from("2026-12-26T05:00:00Z").epochMilliseconds,
    );
  });
});

describe("mapGoogleEvent — recurring instance", () => {
  it("carries the recurring series id on an expanded instance", () => {
    const event = mapped({
      id: "evt-recurring_20260727T130000Z",
      status: "confirmed",
      summary: "Weekly sync",
      recurringEventId: "evt-recurring",
      start: { dateTime: "2026-07-27T09:00:00-04:00" },
      end: { dateTime: "2026-07-27T09:30:00-04:00" },
    });

    expect(event.recurringEventId).toBe("evt-recurring");
    expect(event.googleEventId).toBe("evt-recurring_20260727T130000Z");
  });
});

describe("mapGoogleEvent — cancelled and unmappable", () => {
  it("reports a cancelled event without mapping it to a commitment", () => {
    const result = mapGoogleEvent(
      { id: "evt-gone", status: "cancelled" },
      CONTEXT,
    );
    expect(result).toEqual({ kind: "cancelled", googleEventId: "evt-gone" });
  });

  it("skips an event with no start timing", () => {
    const result = mapGoogleEvent({ id: "evt-empty", summary: "?" }, CONTEXT);
    expect(result.kind).toBe("skip");
  });

  it("defaults a missing summary to a placeholder title", () => {
    const event = mapped({
      id: "evt-untitled",
      start: { dateTime: "2026-07-27T09:00:00-04:00" },
      end: { dateTime: "2026-07-27T09:30:00-04:00" },
    });
    expect(event.title.length).toBeGreaterThan(0);
  });

  it("preserves a tentative status", () => {
    const event = mapped({
      id: "evt-tentative",
      status: "tentative",
      summary: "Maybe",
      start: { dateTime: "2026-07-27T09:00:00-04:00" },
      end: { dateTime: "2026-07-27T09:30:00-04:00" },
    });
    expect(event.status).toBe("tentative");
  });
});
