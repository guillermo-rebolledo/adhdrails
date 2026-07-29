import { describe, expect, it } from "vitest";

import {
  INBOX_TITLE_MAX_LENGTH,
  inboxCaptureRequestSchema,
  inboxTombstoneExpiresAt,
  inboxUpdateRequestSchema,
  isInboxTombstoneExpired,
  resolveCreate,
  resolveUpdate,
} from "./capture";

const validRequest = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Buy milk",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
};

describe("inboxCaptureRequestSchema", () => {
  it("accepts a trimmed title-only capture", () => {
    const parsed = inboxCaptureRequestSchema.parse({
      ...validRequest,
      title: "  Buy milk  ",
    });

    expect(parsed.title).toBe("Buy milk");
  });

  it("rejects an empty title", () => {
    const result = inboxCaptureRequestSchema.safeParse({
      ...validRequest,
      title: "   ",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a title beyond the maximum length", () => {
    const result = inboxCaptureRequestSchema.safeParse({
      ...validRequest,
      title: "x".repeat(INBOX_TITLE_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
  });

  it("requires UUIDs for the id and idempotency key", () => {
    expect(
      inboxCaptureRequestSchema.safeParse({ ...validRequest, id: "not-a-uuid" })
        .success,
    ).toBe(false);
    expect(
      inboxCaptureRequestSchema.safeParse({
        ...validRequest,
        idempotencyKey: "nope",
      }).success,
    ).toBe(false);
  });
});

describe("resolveCreate", () => {
  const incoming = { title: "Buy milk", idempotencyKey: "key-a" };

  it("inserts when nothing is stored under the id", () => {
    expect(resolveCreate(null, incoming)).toBe("insert");
  });

  it("replays a duplicate delivery carrying the same idempotency key", () => {
    expect(
      resolveCreate(
        { title: "Anything else", idempotencyKey: "key-a" },
        incoming,
      ),
    ).toBe("replay");
  });

  it("replays a different key that carries identical content", () => {
    expect(
      resolveCreate({ title: "Buy milk", idempotencyKey: "key-b" }, incoming),
    ).toBe("replay");
  });

  it("reports a conflict for the same id with divergent content", () => {
    expect(
      resolveCreate({ title: "Buy bread", idempotencyKey: "key-b" }, incoming),
    ).toBe("conflict");
  });

  it("reports gone when the id was deleted and tombstoned", () => {
    expect(resolveCreate(null, incoming, true)).toBe("gone");
  });
});

describe("inboxUpdateRequestSchema", () => {
  const KEY = "22222222-2222-4222-8222-222222222222";

  it("accepts a seen update carrying a base version", () => {
    const parsed = inboxUpdateRequestSchema.parse({
      idempotencyKey: KEY,
      baseVersion: 1,
      patch: { seen: true },
    });

    expect(parsed.patch.seen).toBe(true);
  });

  it("rejects an empty patch", () => {
    const result = inboxUpdateRequestSchema.safeParse({
      idempotencyKey: KEY,
      baseVersion: 1,
      patch: {},
    });

    expect(result.success).toBe(false);
  });
});

describe("resolveUpdate", () => {
  const incoming = { baseVersion: 1, idempotencyKey: "key-a" };

  it("is missing when nothing is stored", () => {
    expect(resolveUpdate(null, incoming)).toBe("missing");
  });

  it("is gone when the item was tombstoned", () => {
    expect(
      resolveUpdate({ version: 1, idempotencyKey: "x" }, incoming, true),
    ).toBe("gone");
  });

  it("replays the same idempotency key", () => {
    expect(
      resolveUpdate({ version: 5, idempotencyKey: "key-a" }, incoming),
    ).toBe("replay");
  });

  it("applies a matching base version", () => {
    expect(
      resolveUpdate({ version: 1, idempotencyKey: "key-b" }, incoming),
    ).toBe("apply");
  });

  it("conflicts on a stale base version", () => {
    expect(
      resolveUpdate({ version: 2, idempotencyKey: "key-b" }, incoming),
    ).toBe("conflict");
  });
});

describe("inbox tombstone retention", () => {
  it("expires 30 days after deletion", () => {
    const deletedAt = new Date("2026-07-01T00:00:00.000Z");

    expect(inboxTombstoneExpiresAt(deletedAt).toISOString()).toBe(
      "2026-07-31T00:00:00.000Z",
    );
    expect(
      isInboxTombstoneExpired(deletedAt, new Date("2026-07-30T00:00:00.000Z")),
    ).toBe(false);
    expect(
      isInboxTombstoneExpired(deletedAt, new Date("2026-07-31T00:00:00.000Z")),
    ).toBe(true);
  });
});
