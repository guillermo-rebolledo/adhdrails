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
    isTombstoned: vi.fn().mockResolvedValue(false),
    insert: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listForAccount: vi.fn(),
    ...overrides,
  } as never;
}

const updateRequest = {
  idempotencyKey: KEY,
  baseVersion: 1,
  patch: { seen: true },
};

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

  it("refuses to resurrect a tombstoned id", async () => {
    const insert = vi.fn();
    const service = createInboxService(
      repository({
        isTombstoned: vi.fn().mockResolvedValue(true),
        insert,
      }),
    );

    const result = await service.capture("user_1", request);

    expect(insert).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "gone" });
  });
});

describe("createInboxService.update", () => {
  const stored = record({ version: 1, idempotencyKey: "other-key" });

  it("stamps seenAt once and bumps the version when applying", async () => {
    const update = vi
      .fn()
      .mockResolvedValue(
        record({ seenAt: new Date("2026-07-27T12:00:00.000Z"), version: 2 }),
      );
    const service = createInboxService(
      repository({ getById: vi.fn().mockResolvedValue(stored), update }),
      () => new Date("2026-07-27T12:00:00.000Z"),
    );

    const result = await service.update("user_1", ID, updateRequest);

    expect(update).toHaveBeenCalledWith("user_1", ID, {
      patch: { seen: true },
      seenAt: new Date("2026-07-27T12:00:00.000Z"),
      version: 2,
      idempotencyKey: KEY,
    });
    expect(result).toMatchObject({ ok: true, applied: true });
  });

  it("keeps an existing seenAt rather than restamping", async () => {
    const alreadySeen = record({
      seenAt: new Date("2026-07-26T09:00:00.000Z"),
      version: 1,
      idempotencyKey: "other-key",
    });
    const update = vi.fn().mockResolvedValue(alreadySeen);
    const service = createInboxService(
      repository({ getById: vi.fn().mockResolvedValue(alreadySeen), update }),
      () => new Date("2026-07-27T12:00:00.000Z"),
    );

    await service.update("user_1", ID, updateRequest);

    expect(update).toHaveBeenCalledWith(
      "user_1",
      ID,
      expect.objectContaining({
        seenAt: new Date("2026-07-26T09:00:00.000Z"),
      }),
    );
  });

  it("reports not_found for an unknown id", async () => {
    const service = createInboxService(repository());

    const result = await service.update("user_1", ID, updateRequest);

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("replays an already-applied update", async () => {
    const update = vi.fn();
    const service = createInboxService(
      repository({
        getById: vi.fn().mockResolvedValue(record({ idempotencyKey: KEY })),
        update,
      }),
    );

    const result = await service.update("user_1", ID, updateRequest);

    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, applied: false });
  });

  it("returns a reviewable conflict for a stale base version", async () => {
    const update = vi.fn();
    const service = createInboxService(
      repository({
        getById: vi
          .fn()
          .mockResolvedValue(record({ version: 3, idempotencyKey: "other" })),
        update,
      }),
    );

    const result = await service.update("user_1", ID, updateRequest);

    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("reports gone for a tombstoned id", async () => {
    const service = createInboxService(
      repository({ isTombstoned: vi.fn().mockResolvedValue(true) }),
    );

    const result = await service.update("user_1", ID, updateRequest);

    expect(result).toEqual({ ok: false, reason: "gone" });
  });
});

describe("createInboxService.remove", () => {
  it("delegates deletion (with its tombstone) to the repository", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = createInboxService(repository({ remove }));

    await service.remove("user_1", ID);

    expect(remove).toHaveBeenCalledWith("user_1", ID);
  });
});
