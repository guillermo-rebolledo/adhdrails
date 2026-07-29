import { describe, expect, it } from "vitest";

import {
  computeDeferral,
  orderedCandidates,
  recommendFocus,
  type RecommendableTask,
} from "./recommend";

const TZ = "America/New_York";
// A fixed mid-morning reference so the recommendation is deterministic.
const NOW = "2026-07-27T14:00:00Z"; // 10:00 EDT on Monday 2026-07-27

let seq = 0;
function task(overrides: Partial<RecommendableTask> = {}): RecommendableTask {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    title: `Task ${seq}`,
    scheduledDate: null,
    scheduledTime: null,
    estimateMinutes: null,
    energy: null,
    important: false,
    createdAt: "2026-07-20T12:00:00Z",
    ...overrides,
  };
}

describe("recommendFocus — empty and single", () => {
  it("recommends nothing when there are no eligible tasks", () => {
    const result = recommendFocus([], { now: NOW, timeZone: TZ });
    expect(result.task).toBeNull();
    expect(result.reason).toBeNull();
    expect(result.alternatives).toEqual([]);
  });

  it("does not manufacture urgency from future-scheduled tasks", () => {
    // A task scheduled for a future day is visible elsewhere but not "for now".
    const future = task({ scheduledDate: "2026-07-30" });
    const result = recommendFocus([future], { now: NOW, timeZone: TZ });
    expect(result.task).toBeNull();
  });

  it("recommends the only available task as next-up", () => {
    const only = task({ title: "Write the report" });
    const result = recommendFocus([only], { now: NOW, timeZone: TZ });
    expect(result.task?.id).toBe(only.id);
    expect(result.reason?.code).toBe("next-up");
    expect(result.alternatives).toEqual([]);
  });
});

describe("recommendFocus — deterministic ordering", () => {
  it("surfaces a timed task whose time has come ahead of flexible work", () => {
    const flexible = task({ title: "Flexible", important: true });
    const timed = task({
      title: "Standup",
      scheduledDate: "2026-07-27",
      scheduledTime: "09:30", // already passed at 10:00 local
    });
    const result = recommendFocus([flexible, timed], {
      now: NOW,
      timeZone: TZ,
    });
    expect(result.task?.id).toBe(timed.id);
    expect(result.reason?.code).toBe("scheduled-time");
    // The flexible task is still offered, never hidden.
    expect(result.alternatives.map((t) => t.id)).toContain(flexible.id);
  });

  it("treats a timed task later today as an upcoming commitment, not a now recommendation", () => {
    const later = task({
      title: "Afternoon meeting",
      scheduledDate: "2026-07-27",
      scheduledTime: "15:00", // 3pm local, still in the future
    });
    const flexible = task({ title: "Flexible now" });
    const result = recommendFocus([later, flexible], {
      now: NOW,
      timeZone: TZ,
    });
    expect(result.task?.id).toBe(flexible.id);
  });

  it("ranks Important flexible work above unmarked work", () => {
    const plain = task({ title: "Plain", createdAt: "2026-07-19T12:00:00Z" });
    const important = task({ title: "Important", important: true });
    const result = recommendFocus([plain, important], {
      now: NOW,
      timeZone: TZ,
    });
    expect(result.task?.id).toBe(important.id);
    expect(result.reason?.code).toBe("important");
  });

  it("breaks ties by waiting time — the longest-waiting task first", () => {
    const newer = task({ title: "Newer", createdAt: "2026-07-25T12:00:00Z" });
    const older = task({ title: "Older", createdAt: "2026-07-10T12:00:00Z" });
    const result = recommendFocus([newer, older], { now: NOW, timeZone: TZ });
    expect(result.task?.id).toBe(older.id);
  });
});

describe("recommendFocus — estimate fit against upcoming commitments", () => {
  it("prefers work that fits before the next commitment", () => {
    const long = task({ title: "Two hours", estimateMinutes: 120 });
    const short = task({ title: "Ten minutes", estimateMinutes: 10 });
    const result = recommendFocus([long, short], {
      now: NOW,
      timeZone: TZ,
      // Next commitment 30 minutes away.
      commitments: [{ startAt: "2026-07-27T14:30:00Z" }],
    });
    expect(result.task?.id).toBe(short.id);
    expect(result.reason?.code).toBe("fits-commitment");
    // The long task is still available, just ordered lower.
    expect(result.alternatives.map((t) => t.id)).toEqual([long.id]);
  });

  it("does not apply a fit penalty when there is no upcoming commitment", () => {
    const long = task({
      title: "Two hours",
      estimateMinutes: 120,
      important: true,
    });
    const short = task({ title: "Ten minutes", estimateMinutes: 10 });
    const result = recommendFocus([long, short], { now: NOW, timeZone: TZ });
    // With no commitment, Important wins.
    expect(result.task?.id).toBe(long.id);
  });

  it("counts a timed task as an upcoming commitment for the fit window", () => {
    const long = task({ title: "Long", estimateMinutes: 120 });
    const short = task({ title: "Short", estimateMinutes: 10 });
    // A timed task 20 minutes out is the next commitment.
    const meeting = task({
      title: "Call",
      scheduledDate: "2026-07-27",
      scheduledTime: "10:20",
    });
    const result = recommendFocus([long, short, meeting], {
      now: NOW,
      timeZone: TZ,
    });
    expect(result.task?.id).toBe(short.id);
  });
});

describe("recommendFocus — energy reorders but never hides flexible work", () => {
  it("prefers a task matching the current energy", () => {
    const high = task({ title: "High energy", energy: "high" });
    const low = task({ title: "Low energy", energy: "low" });
    const result = recommendFocus([high, low], {
      now: NOW,
      timeZone: TZ,
      currentEnergy: "low",
    });
    expect(result.task?.id).toBe(low.id);
    expect(result.reason?.code).toBe("matches-energy");
    // Non-matching work is reordered, not removed.
    expect(result.alternatives.map((t) => t.id)).toEqual([high.id]);
  });

  it("keeps Any-energy tasks eligible above a mismatched energy", () => {
    const any = task({ title: "Any", energy: null });
    const mismatch = task({ title: "High", energy: "high" });
    const result = recommendFocus([mismatch, any], {
      now: NOW,
      timeZone: TZ,
      currentEnergy: "low",
    });
    expect(result.task?.id).toBe(any.id);
  });

  it("explains the deciding rule, not an incidental attribute", () => {
    // The winner is both Important and an Energy match, but Energy is the
    // higher-priority rule that put it ahead — so that is what is explained.
    const winner = task({
      title: "Low and important",
      energy: "low",
      important: true,
    });
    const runnerUp = task({ title: "High", energy: "high" });
    const result = recommendFocus([runnerUp, winner], {
      now: NOW,
      timeZone: TZ,
      currentEnergy: "low",
    });
    expect(result.task?.id).toBe(winner.id);
    expect(result.reason?.code).toBe("matches-energy");
  });

  it("imposes no energy constraint when current energy is not set", () => {
    const high = task({
      title: "High important",
      energy: "high",
      important: true,
    });
    const low = task({ title: "Low", energy: "low" });
    const result = recommendFocus([high, low], { now: NOW, timeZone: TZ });
    // Without a current energy, Important decides — energy does not reorder.
    expect(result.task?.id).toBe(high.id);
  });

  it("never lets energy reorder a scheduled commitment", () => {
    const timed = task({
      title: "Meeting",
      scheduledDate: "2026-07-27",
      scheduledTime: "09:00",
      energy: "high",
    });
    const low = task({ title: "Low flexible", energy: "low" });
    const result = recommendFocus([timed, low], {
      now: NOW,
      timeZone: TZ,
      currentEnergy: "low",
    });
    // The timed commitment stays first regardless of energy.
    expect(result.task?.id).toBe(timed.id);
  });
});

describe("orderedCandidates", () => {
  it("returns the recommended task first followed by its alternatives", () => {
    const a = task({ title: "A", important: true });
    const b = task({ title: "B" });
    const result = recommendFocus([b, a], { now: NOW, timeZone: TZ });
    const ordered = orderedCandidates(result);
    expect(ordered.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("is empty when nothing is recommended", () => {
    const result = recommendFocus([], { now: NOW, timeZone: TZ });
    expect(orderedCandidates(result)).toEqual([]);
  });
});

describe("computeDeferral", () => {
  it("defers to tomorrow as a date-only schedule", () => {
    const deferral = computeDeferral(NOW, TZ, "tomorrow");
    expect(deferral).toEqual({
      scheduledDate: "2026-07-28",
      scheduledTime: null,
    });
  });

  it("defers to a chosen date as a date-only schedule", () => {
    const deferral = computeDeferral(NOW, TZ, "custom", "2026-08-15");
    expect(deferral).toEqual({
      scheduledDate: "2026-08-15",
      scheduledTime: null,
    });
  });

  it("requires a date when deferring to a custom day", () => {
    expect(() => computeDeferral(NOW, TZ, "custom")).toThrow();
  });

  it("defers to later today as a timed schedule a few hours out", () => {
    const deferral = computeDeferral(NOW, TZ, "later-today");
    // 10:00 EDT + 3h = 13:00 EDT, still today.
    expect(deferral).toEqual({
      scheduledDate: "2026-07-27",
      scheduledTime: "13:00",
    });
  });

  it("keeps later today on today, clamping when a few hours would cross midnight", () => {
    // 23:30 EDT on 2026-07-27; +3h would land tomorrow, so it clamps to today.
    const lateNight = "2026-07-28T03:30:00Z";
    const deferral = computeDeferral(lateNight, TZ, "later-today");
    expect(deferral).toEqual({
      scheduledDate: "2026-07-27",
      scheduledTime: "23:59",
    });
  });
});
