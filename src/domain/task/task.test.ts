import { describe, expect, it } from "vitest";

import {
  isDateOnlySchedule,
  isEnergyEligible,
  isTimedSchedule,
  isTombstoneExpired,
  isUnscheduled,
  resolveCompletedAt,
  resolveCreate,
  resolveEffectiveEnergy,
  resolveUpdate,
  taskCreateRequestSchema,
  taskPatchSchema,
  tombstoneExpiresAt,
  TOMBSTONE_RETENTION_DAYS,
} from "./task";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

describe("taskCreateRequestSchema", () => {
  it("accepts a title-only create and trims the title", () => {
    const parsed = taskCreateRequestSchema.parse({
      id: ID,
      title: "  Write the report  ",
      idempotencyKey: KEY,
    });

    expect(parsed.title).toBe("Write the report");
  });

  it("rejects an empty title", () => {
    const result = taskCreateRequestSchema.safeParse({
      id: ID,
      title: "   ",
      idempotencyKey: KEY,
    });

    expect(result.success).toBe(false);
  });
});

describe("taskCreateRequestSchema planning metadata", () => {
  const base = { id: ID, title: "Write the report", idempotencyKey: KEY };

  it("accepts a date-only schedule without a time", () => {
    const parsed = taskCreateRequestSchema.parse({
      ...base,
      scheduledDate: "2026-08-01",
    });

    expect(parsed.scheduledDate).toBe("2026-08-01");
    expect(parsed.scheduledTime).toBeUndefined();
  });

  it("accepts a timed schedule with a date and time", () => {
    const parsed = taskCreateRequestSchema.parse({
      ...base,
      scheduledDate: "2026-08-01",
      scheduledTime: "09:30",
    });

    expect(parsed.scheduledTime).toBe("09:30");
  });

  it("rejects a time without a date", () => {
    const result = taskCreateRequestSchema.safeParse({
      ...base,
      scheduledTime: "09:30",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a malformed date and time", () => {
    expect(
      taskCreateRequestSchema.safeParse({
        ...base,
        scheduledDate: "2026-13-40",
      }).success,
    ).toBe(false);
    expect(
      taskCreateRequestSchema.safeParse({
        ...base,
        scheduledDate: "2026-08-01",
        scheduledTime: "25:00",
      }).success,
    ).toBe(false);
  });

  it("accepts optional energy, estimate, important, notes, and area", () => {
    const areaId = "33333333-3333-4333-8333-333333333333";
    const parsed = taskCreateRequestSchema.parse({
      ...base,
      energy: "high",
      estimateMinutes: 25,
      important: true,
      notes: "Draft first, edit later.",
      areaId,
    });

    expect(parsed).toMatchObject({
      energy: "high",
      estimateMinutes: 25,
      important: true,
      areaId,
    });
  });

  it("rejects a non-positive estimate", () => {
    expect(
      taskCreateRequestSchema.safeParse({ ...base, estimateMinutes: 0 })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown energy value", () => {
    expect(
      taskCreateRequestSchema.safeParse({ ...base, energy: "urgent" }).success,
    ).toBe(false);
  });
});

describe("taskPatchSchema", () => {
  it("requires at least one field", () => {
    expect(taskPatchSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a status-only patch", () => {
    expect(taskPatchSchema.parse({ status: "completed" })).toEqual({
      status: "completed",
    });
  });

  it("clears a schedule by patching the date to null", () => {
    expect(
      taskPatchSchema.parse({ scheduledDate: null, scheduledTime: null }),
    ).toEqual({ scheduledDate: null, scheduledTime: null });
  });

  it("clears an area by patching areaId to null", () => {
    expect(taskPatchSchema.parse({ areaId: null })).toEqual({ areaId: null });
  });

  it("allows setting a time when the date is not part of the patch", () => {
    // The stored date may still satisfy it; the server applies it against the record.
    expect(taskPatchSchema.parse({ scheduledTime: "08:00" })).toEqual({
      scheduledTime: "08:00",
    });
  });

  it("rejects setting a time while clearing the date in one patch", () => {
    expect(
      taskPatchSchema.safeParse({
        scheduledTime: "08:00",
        scheduledDate: null,
      }).success,
    ).toBe(false);
  });
});

describe("energy semantics", () => {
  it("treats unset energy as Any", () => {
    expect(resolveEffectiveEnergy(null)).toBe("any");
    expect(resolveEffectiveEnergy(undefined)).toBe("any");
    expect(resolveEffectiveEnergy("low")).toBe("low");
  });

  it("never hides a Task without energy, whatever the current energy", () => {
    expect(isEnergyEligible(null, "low")).toBe(true);
    expect(isEnergyEligible(null, "high")).toBe(true);
    expect(isEnergyEligible(undefined, null)).toBe(true);
  });

  it("imposes no constraint when the current energy is unset", () => {
    expect(isEnergyEligible("high", null)).toBe(true);
  });

  it("matches a Task's energy against the current energy", () => {
    expect(isEnergyEligible("low", "low")).toBe(true);
    expect(isEnergyEligible("high", "low")).toBe(false);
  });
});

describe("schedule helpers", () => {
  it("distinguishes date-only from timed and unscheduled", () => {
    const dateOnly = { scheduledDate: "2026-08-01", scheduledTime: null };
    const timed = { scheduledDate: "2026-08-01", scheduledTime: "09:00" };
    const none = { scheduledDate: null, scheduledTime: null };

    expect(isDateOnlySchedule(dateOnly)).toBe(true);
    expect(isTimedSchedule(dateOnly)).toBe(false);

    expect(isTimedSchedule(timed)).toBe(true);
    expect(isDateOnlySchedule(timed)).toBe(false);

    expect(isUnscheduled(none)).toBe(true);
    expect(isDateOnlySchedule(none)).toBe(false);
  });
});

describe("resolveCreate", () => {
  const incoming = { title: "Write the report", idempotencyKey: KEY };

  it("inserts when nothing is stored", () => {
    expect(resolveCreate(null, incoming)).toBe("insert");
  });

  it("replays a duplicate idempotency key", () => {
    expect(
      resolveCreate({ title: "Anything", idempotencyKey: KEY }, incoming),
    ).toBe("replay");
  });

  it("replays identical content under a different key", () => {
    expect(
      resolveCreate(
        { title: "Write the report", idempotencyKey: "other" },
        incoming,
      ),
    ).toBe("replay");
  });

  it("conflicts on a divergent id collision", () => {
    expect(
      resolveCreate(
        { title: "Something else", idempotencyKey: "other" },
        incoming,
      ),
    ).toBe("conflict");
  });

  it("never resurrects a tombstoned id", () => {
    expect(resolveCreate(null, incoming, true)).toBe("gone");
  });
});

describe("resolveUpdate", () => {
  const incoming = { baseVersion: 2, idempotencyKey: KEY };

  it("reports a missing task", () => {
    expect(resolveUpdate(null, incoming)).toBe("missing");
  });

  it("replays a duplicate mutation", () => {
    expect(resolveUpdate({ version: 5, idempotencyKey: KEY }, incoming)).toBe(
      "replay",
    );
  });

  it("applies when the base version matches", () => {
    expect(
      resolveUpdate({ version: 2, idempotencyKey: "other" }, incoming),
    ).toBe("apply");
  });

  it("conflicts on a stale base version", () => {
    expect(
      resolveUpdate({ version: 3, idempotencyKey: "other" }, incoming),
    ).toBe("conflict");
  });

  it("treats a tombstoned task as gone", () => {
    expect(
      resolveUpdate({ version: 2, idempotencyKey: "other" }, incoming, true),
    ).toBe("gone");
  });
});

describe("resolveCompletedAt", () => {
  it("stamps the completion instant when first completed", () => {
    expect(resolveCompletedAt(null, "completed", "now")).toBe("now");
  });

  it("keeps an existing completion instant on a redundant complete", () => {
    expect(resolveCompletedAt("earlier", "completed", "now")).toBe("earlier");
  });

  it("clears the instant when returning to active", () => {
    expect(resolveCompletedAt("earlier", "active", "now")).toBeNull();
  });

  it("leaves the instant untouched when status is not part of the change", () => {
    expect(resolveCompletedAt("earlier", undefined, "now")).toBe("earlier");
  });
});

describe("tombstone retention", () => {
  it("expires exactly 30 days after deletion", () => {
    const deletedAt = new Date("2026-07-26T10:00:00.000Z");
    const expires = tombstoneExpiresAt(deletedAt);

    const days =
      (expires.getTime() - deletedAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(TOMBSTONE_RETENTION_DAYS);
  });

  it("is not expired before retention elapses", () => {
    const deletedAt = new Date("2026-07-26T10:00:00.000Z");
    expect(
      isTombstoneExpired(deletedAt, new Date("2026-08-20T10:00:00.000Z")),
    ).toBe(false);
    expect(
      isTombstoneExpired(deletedAt, new Date("2026-08-26T10:00:00.000Z")),
    ).toBe(true);
  });
});
