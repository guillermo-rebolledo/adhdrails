import { describe, expect, it } from "vitest";

import {
  INBOX_TITLE_MAX_LENGTH,
  inboxCaptureRequestSchema,
  resolveCreate,
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
});
