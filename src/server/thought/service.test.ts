import { describe, expect, it, vi } from "vitest";

import type { ThoughtRecord } from "./repository";
import { createThoughtService } from "./service";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

function record(overrides: Partial<ThoughtRecord> = {}): ThoughtRecord {
  return {
    id: ID,
    title: "Reference",
    body: "Useful detail",
    sourceInboxItemId: null,
    version: 1,
    lastMutationKey: KEY,
    deletedAt: null,
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
    mutate: vi.fn(),
    purgeDeletedBefore: vi.fn(),
    ...overrides,
  } as never;
}

describe("Thought service", () => {
  it("creates a Thought within the authenticated account scope", async () => {
    const insert = vi.fn().mockResolvedValue(record());
    const service = createThoughtService(repository({ insert }));
    const request = {
      id: ID,
      title: "Reference",
      body: "Useful detail",
      sourceInboxItemId: null,
      idempotencyKey: KEY,
    };

    const result = await service.create("user_1", request);

    expect(insert).toHaveBeenCalledWith("user_1", request);
    expect(result).toMatchObject({ ok: true, created: true });
  });

  it("returns a reviewable conflict instead of overwriting a newer Thought", async () => {
    const current = record({ version: 2, title: "Newer title" });
    const service = createThoughtService(
      repository({ getById: vi.fn().mockResolvedValue(current) }),
    );

    const result = await service.update("user_1", ID, {
      title: "Stale edit",
      body: "",
      baseVersion: 1,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    });

    expect(result).toEqual({ ok: false, reason: "conflict", current });
  });

  it("retains a deletion tombstone and can restore it for Undo", async () => {
    const active = record();
    const deleted = record({
      version: 2,
      deletedAt: new Date("2026-07-26T10:01:00.000Z"),
    });
    const mutate = vi
      .fn()
      .mockResolvedValueOnce(deleted)
      .mockResolvedValueOnce(record({ version: 3 }));
    const getById = vi
      .fn()
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(deleted);
    const service = createThoughtService(repository({ getById, mutate }));

    const removed = await service.setDeleted("user_1", ID, {
      deleted: true,
      baseVersion: 1,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    });
    const restored = await service.setDeleted("user_1", ID, {
      deleted: false,
      baseVersion: 2,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });

    expect(removed).toMatchObject({ ok: true, thought: deleted });
    expect(restored).toMatchObject({
      ok: true,
      thought: { version: 3, deletedAt: null },
    });
    expect(mutate).toHaveBeenNthCalledWith(
      1,
      "user_1",
      ID,
      expect.objectContaining({ deleted: true }),
    );
  });

  it("purges only tombstones older than 30 days while listing", async () => {
    const purgeDeletedBefore = vi.fn().mockResolvedValue(undefined);
    const listForAccount = vi.fn().mockResolvedValue([record()]);
    const service = createThoughtService(
      repository({ purgeDeletedBefore, listForAccount }),
    );

    await service.listForAccount("user_1");

    expect(purgeDeletedBefore).toHaveBeenCalledWith("user_1", expect.any(Date));
    expect(listForAccount).toHaveBeenCalledWith("user_1");
  });
});
