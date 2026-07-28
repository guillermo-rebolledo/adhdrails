import { describe, expect, it } from "vitest";

import { orderNextItems } from "./next-items";

const TZ = "America/New_York";
// 2026-07-27T14:00 in New York (EDT, UTC-4).
const NOW = "2026-07-27T18:00:00.000Z";

describe("orderNextItems", () => {
  it("orders today's remaining events and scheduled tasks before unscheduled work", () => {
    const result = orderNextItems({
      now: NOW,
      timeZone: TZ,
      events: [
        // 16:00 local today — remaining.
        { id: "e-late", title: "Standup", startAt: "2026-07-27T20:00:00.000Z" },
        // 15:00 local today — remaining, earlier.
        { id: "e-soon", title: "Call", startAt: "2026-07-27T19:00:00.000Z" },
      ],
      tasks: [
        // Timed for 14:30 local today — remaining, earliest of all.
        {
          id: "t-timed",
          title: "Review PR",
          scheduledDate: "2026-07-27",
          scheduledTime: "14:30",
          createdAt: "2026-07-20T00:00:00.000Z",
        },
        // Date-only today — time-sensitive but timeless (after timed items).
        {
          id: "t-today",
          title: "Water plants",
          scheduledDate: "2026-07-27",
          scheduledTime: null,
          createdAt: "2026-07-19T00:00:00.000Z",
        },
        // Unscheduled — flexible, waiting longest.
        {
          id: "t-old",
          title: "Old idea",
          scheduledDate: null,
          scheduledTime: null,
          createdAt: "2026-07-01T00:00:00.000Z",
        },
        // Unscheduled — flexible, newer.
        {
          id: "t-new",
          title: "Fresh idea",
          scheduledDate: null,
          scheduledTime: null,
          createdAt: "2026-07-10T00:00:00.000Z",
        },
      ],
    });

    expect(result.timeSensitive.map((item) => item.id)).toEqual([
      "t-timed", // 14:30
      "e-soon", // 15:00
      "e-late", // 16:00
      "t-today", // date-only today, no time — last of the time-sensitive group
    ]);
    // Flexible unscheduled tasks, oldest (waiting longest) first.
    expect(result.flexible.map((item) => item.id)).toEqual(["t-old", "t-new"]);
    expect(result.flexible.every((item) => item.kind === "task")).toBe(true);
  });

  it("excludes past events and other days' scheduled tasks", () => {
    const result = orderNextItems({
      now: NOW,
      timeZone: TZ,
      events: [
        // Already started (13:00 local) — not remaining.
        { id: "e-past", title: "Past", startAt: "2026-07-27T17:00:00.000Z" },
        // Tomorrow — not today's decision.
        {
          id: "e-tomorrow",
          title: "Tomorrow",
          startAt: "2026-07-28T15:00:00.000Z",
        },
      ],
      tasks: [
        // Scheduled for a future day — excluded.
        {
          id: "t-future",
          title: "Next week",
          scheduledDate: "2026-08-01",
          scheduledTime: null,
          createdAt: "2026-07-01T00:00:00.000Z",
        },
        // Scheduled for a past day — excluded from next items.
        {
          id: "t-past",
          title: "Yesterday",
          scheduledDate: "2026-07-26",
          scheduledTime: null,
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });

    expect(result.timeSensitive).toEqual([]);
    expect(result.flexible).toEqual([]);
  });

  it("keeps a timed task earlier today even after its time has passed", () => {
    const result = orderNextItems({
      now: NOW,
      timeZone: TZ,
      events: [],
      tasks: [
        // Timed 09:00 local today; its time has passed but it is not hidden.
        {
          id: "t-earlier",
          title: "Morning task",
          scheduledDate: "2026-07-27",
          scheduledTime: "09:00",
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });

    expect(result.timeSensitive.map((item) => item.id)).toEqual(["t-earlier"]);
  });

  it("returns empty groups when there is nothing to do next", () => {
    expect(
      orderNextItems({ now: NOW, timeZone: TZ, events: [], tasks: [] }),
    ).toEqual({ timeSensitive: [], flexible: [] });
  });
});
