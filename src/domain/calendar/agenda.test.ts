import { describe, expect, it } from "vitest";

import {
  addMinutesToInstant,
  DEFAULT_EVENT_DURATION_MINUTES,
  durationMinutesBetween,
  groupEventsByDay,
  instantFromLocalParts,
  isAfterWeek,
  isWithinWeek,
  plainDateInZone,
  weekBounds,
  weekDays,
} from "./agenda";

const NY = "America/New_York";
const BERLIN = "Europe/Berlin";

describe("duration math", () => {
  it("adds the default 30-minute duration to a start instant", () => {
    expect(
      addMinutesToInstant(
        "2026-07-20T13:00:00Z",
        DEFAULT_EVENT_DURATION_MINUTES,
      ),
    ).toBe("2026-07-20T13:30:00Z");
  });

  it("reports whole minutes between two instants", () => {
    expect(
      durationMinutesBetween("2026-07-20T13:00:00Z", "2026-07-20T14:15:00Z"),
    ).toBe(75);
  });

  it("adds minutes across a spring-forward DST gap without shifting wall time expectations", () => {
    // 06:30Z is 01:30 local in New York the morning the clocks jump to 03:00.
    // Adding 60 minutes lands on the same instant regardless of DST; the point
    // is that instant math never double-counts the skipped hour.
    expect(addMinutesToInstant("2026-03-08T06:30:00Z", 60)).toBe(
      "2026-03-08T07:30:00Z",
    );
  });
});

describe("instantFromLocalParts", () => {
  it("resolves a local date and time in a zone to an instant", () => {
    // 09:00 in New York on a July day is EDT (-04:00) => 13:00Z.
    expect(instantFromLocalParts("2026-07-20", "09:00", NY)).toBe(
      "2026-07-20T13:00:00Z",
    );
  });

  it("disambiguates a nonexistent spring-forward time forward", () => {
    // 02:30 does not exist on 2026-03-08 in New York; it maps to 03:30 EDT.
    expect(instantFromLocalParts("2026-03-08", "02:30", NY)).toBe(
      "2026-03-08T07:30:00Z",
    );
  });
});

describe("plainDateInZone", () => {
  it("resolves the local date an instant falls on", () => {
    // 03:00Z on the 21st is still the 20th at 23:00 in New York.
    expect(plainDateInZone("2026-07-21T03:00:00Z", NY)).toBe("2026-07-20");
    expect(plainDateInZone("2026-07-21T03:00:00Z", BERLIN)).toBe("2026-07-21");
  });
});

describe("weekBounds and weekDays", () => {
  it("spans Monday 00:00 local to the following Monday 00:00 local", () => {
    // 2026-07-22 is a Wednesday.
    const bounds = weekBounds("2026-07-22T12:00:00Z", NY);
    // Monday 2026-07-20 00:00 in New York is 04:00Z (EDT, -04:00).
    expect(bounds.startAt).toBe("2026-07-20T04:00:00Z");
    expect(bounds.endAt).toBe("2026-07-27T04:00:00Z");
  });

  it("lists the seven local dates of the week, Monday first", () => {
    expect(weekDays("2026-07-22T12:00:00Z", NY)).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]);
  });

  it("keeps a full seven-day span even when the week contains a DST transition", () => {
    // US spring-forward is Sunday 2026-03-08. The week Mon 03-02 .. Mon 03-09.
    const days = weekDays("2026-03-04T12:00:00Z", NY);
    expect(days).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
    const bounds = weekBounds("2026-03-04T12:00:00Z", NY);
    // Monday 03-02 00:00 is EST (-05:00) => 05:00Z; next Monday 03-09 00:00 is
    // EDT (-04:00) => 04:00Z. The span is still exactly seven local days.
    expect(bounds.startAt).toBe("2026-03-02T05:00:00Z");
    expect(bounds.endAt).toBe("2026-03-09T04:00:00Z");
  });
});

describe("isWithinWeek / isAfterWeek", () => {
  const bounds = weekBounds("2026-07-22T12:00:00Z", NY);

  it("includes the start instant and excludes the end instant", () => {
    expect(isWithinWeek(bounds.startAt, bounds)).toBe(true);
    expect(isWithinWeek(bounds.endAt, bounds)).toBe(false);
    expect(isAfterWeek(bounds.endAt, bounds)).toBe(true);
  });

  it("classifies an instant beyond the week as Later", () => {
    expect(isWithinWeek("2026-08-01T12:00:00Z", bounds)).toBe(false);
    expect(isAfterWeek("2026-08-01T12:00:00Z", bounds)).toBe(true);
  });
});

describe("groupEventsByDay", () => {
  it("returns seven ordered day columns and buckets events by local start date", () => {
    const events = [
      {
        id: "b",
        startAt: "2026-07-22T17:00:00Z",
        endAt: "2026-07-22T17:30:00Z",
      },
      {
        id: "a",
        startAt: "2026-07-22T13:00:00Z",
        endAt: "2026-07-22T13:30:00Z",
      },
      // 2026-07-24 03:00Z is the 23rd at 23:00 local in New York.
      {
        id: "c",
        startAt: "2026-07-24T03:00:00Z",
        endAt: "2026-07-24T03:30:00Z",
      },
      // Outside the week -> ignored here (belongs to Later).
      {
        id: "z",
        startAt: "2026-08-01T12:00:00Z",
        endAt: "2026-08-01T12:30:00Z",
      },
    ];

    const days = groupEventsByDay(events, "2026-07-22T12:00:00Z", NY);

    expect(days).toHaveLength(7);
    expect(days.map((day) => day.date)).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]);
    // Wednesday holds a and b, ordered by start instant.
    const wednesday = days.find((day) => day.date === "2026-07-22");
    expect(wednesday?.events.map((event) => event.id)).toEqual(["a", "b"]);
    // c lands on Thursday the 23rd in local time, not the UTC 24th.
    const thursday = days.find((day) => day.date === "2026-07-23");
    expect(thursday?.events.map((event) => event.id)).toEqual(["c"]);
    // The August event never appears in the weekly grid.
    expect(
      days.flatMap((day) => day.events).some((event) => event.id === "z"),
    ).toBe(false);
  });
});
