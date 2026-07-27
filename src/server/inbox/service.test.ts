import { describe, expect, it, vi } from "vitest";

import type { InboxItemRecord } from "./repository";
import { createInboxService } from "./service";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

function record(overrides: Partial<InboxItemRecord> = {}): InboxItemRecord {
  return {
    id: ID,
    title: "Buy milk",
    seenAt: null,
    version: 1,
    idempotencyKey: KEY,
    createdAt: new Date("2026-07-26T10:00:00.000Z"),
    updatedAt: new Date("2026-07-26T10:00:00.000Z"),
    ...overrides,
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    getById: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
    listForAccount: vi.fn(),
    ...overrides,
  } as never;
}

const request = { id: ID, title: "Buy milk", idempotencyKey: KEY };

describe("createInboxService.capture", () => {
  it("rejects an invalid capture before touching the repository", async () => {
    const insert = vi.fn();
    const service = createInboxService(repository({ insert }));

    const result = await service.capture("user_1", { id: "nope", title: "" });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts a fresh capture scoped to the account", async () => {
    const insert = vi.fn().mockResolvedValue(record());
    const service = createInboxService(repository({ insert }));

    const result = await service.capture("user_1", request);

    expect(insert).toHaveBeenCalledWith("user_1", request);
    expect(result).toMatchObject({ ok: true, created: true });
  });

  it("replays a duplicate delivery without inserting again", async () => {
    const insert = vi.fn();
    const service = createInboxService(
      repository({ getById: vi.fn().mockResolvedValue(record()), insert }),
    );

    const result = await service.capture("user_1", request);

    expect(insert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, created: false });
  });

  it("returns a reviewable conflict for a divergent id collision", async () => {
    const stored = record({ title: "Buy bread", idempotencyKey: "other-key" });
    const insert = vi.fn();
    const service = createInboxService(
      repository({ getById: vi.fn().mockResolvedValue(stored), insert }),
    );

    const result = await service.capture("user_1", request);

    expect(insert).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "conflict", current: stored });
  });
});
