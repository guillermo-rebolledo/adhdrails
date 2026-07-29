import { describe, expect, it } from "vitest";

import {
  decodeTaskCursor,
  encodeTaskCursor,
  paginateTasks,
  taskMatchesCollection,
  taskMatchesFilters,
} from "./collection";

const TODAY = "2026-07-27";
const active = {
  status: "active" as const,
  scheduledDate: null,
  energy: null,
  areaId: null,
  deletedAt: null,
};

describe("Task collection membership", () => {
  it("keeps scheduled and unscheduled active Tasks in Anytime", () => {
    expect(taskMatchesCollection(active, "anytime", TODAY)).toBe(true);
    expect(
      taskMatchesCollection(
        { ...active, scheduledDate: "2026-08-01" },
        "anytime",
        TODAY,
      ),
    ).toBe(true);
  });

  it("separates Today, Upcoming, and Completed without an overdue state", () => {
    expect(
      taskMatchesCollection(
        { ...active, scheduledDate: TODAY },
        "today",
        TODAY,
      ),
    ).toBe(true);
    expect(
      taskMatchesCollection(
        { ...active, scheduledDate: "2026-07-28" },
        "upcoming",
        TODAY,
      ),
    ).toBe(true);
    expect(
      taskMatchesCollection(
        {
          ...active,
          status: "completed",
          scheduledDate: "2026-07-01",
        },
        "completed",
        TODAY,
      ),
    ).toBe(true);
    expect(
      taskMatchesCollection(
        { ...active, scheduledDate: "2026-07-01" },
        "today",
        TODAY,
      ),
    ).toBe(false);
  });

  it("filters deliberately by Area, Energy, and unset Energy", () => {
    const task = { ...active, areaId: "area-1", energy: "low" as const };
    expect(taskMatchesFilters(task, { areaId: "area-1", energy: "low" })).toBe(
      true,
    );
    expect(taskMatchesFilters(task, { areaId: "area-2" })).toBe(false);
    expect(taskMatchesFilters(task, { energy: "high" })).toBe(false);
    expect(taskMatchesFilters(active, { energy: "unset" })).toBe(true);
  });

  it("never lets Energy hide fixed Today or Upcoming commitments", () => {
    const fixed = { ...active, energy: "high" as const };

    expect(taskMatchesFilters(fixed, { energy: "low" }, "today")).toBe(true);
    expect(taskMatchesFilters(fixed, { energy: "low" }, "upcoming")).toBe(true);
    expect(taskMatchesFilters(fixed, { energy: "low" }, "anytime")).toBe(false);
  });
});

describe("Task collection cursor", () => {
  it("round-trips the stable creation instant and UUID", () => {
    const cursor = {
      createdAt: "2026-07-27T10:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
    };
    expect(decodeTaskCursor(encodeTaskCursor(cursor))).toEqual(cursor);
    expect(decodeTaskCursor("not-a-cursor")).toBeNull();
  });

  it("uses the last visible row as the next stable page boundary", () => {
    const rows = [
      {
        createdAt: "2026-07-27T10:00:00.000Z",
        id: "11111111-1111-4111-8111-111111111111",
      },
      {
        createdAt: "2026-07-27T10:00:00.000Z",
        id: "22222222-2222-4222-8222-222222222222",
      },
      {
        createdAt: "2026-07-28T10:00:00.000Z",
        id: "33333333-3333-4333-8333-333333333333",
      },
    ];

    const page = paginateTasks(rows, 2, (row) => row);

    expect(page.items).toEqual(rows.slice(0, 2));
    expect(decodeTaskCursor(page.nextCursor!)).toEqual(rows[1]);
  });
});
