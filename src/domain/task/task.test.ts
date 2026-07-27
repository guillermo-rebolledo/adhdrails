import { describe, expect, it } from "vitest";

import {
  isTombstoneExpired,
  resolveCompletedAt,
  resolveCreate,
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

describe("taskPatchSchema", () => {
  it("requires at least one field", () => {
    expect(taskPatchSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a status-only patch", () => {
    expect(taskPatchSchema.parse({ status: "completed" })).toEqual({
      status: "completed",
    });
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
