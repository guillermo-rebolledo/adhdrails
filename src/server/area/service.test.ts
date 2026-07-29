import { describe, expect, it, vi } from "vitest";

import type { AreaRecord } from "./repository";
import { createAreaService } from "./service";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

function record(overrides: Partial<AreaRecord> = {}): AreaRecord {
  return {
    id: ID,
    name: "Work",
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

const createRequest = { id: ID, name: "Work", idempotencyKey: KEY };

describe("createAreaService.create", () => {
  it("rejects an invalid create before touching the repository", async () => {
    const insert = vi.fn();
    const service = createAreaService(repository({ insert }));

    const result = await service.create("user_1", { id: "nope", name: "" });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts a fresh area", async () => {
    const insert = vi.fn().mockResolvedValue(record());
    const service = createAreaService(repository({ insert }));

    const result = await service.create("user_1", createRequest);

    expect(insert).toHaveBeenCalledWith("user_1", createRequest);
    expect(result).toMatchObject({ ok: true, created: true });
  });

  it("replays a duplicate delivery without inserting again", async () => {
    const insert = vi.fn();
    const service = createAreaService(
      repository({ getById: vi.fn().mockResolvedValue(record()), insert }),
    );

    const result = await service.create("user_1", createRequest);

    expect(insert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, created: false });
  });

  it("returns a reviewable conflict on a divergent id collision", async () => {
    const stored = record({ name: "Home", idempotencyKey: "other" });
    const insert = vi.fn();
    const service = createAreaService(
      repository({ getById: vi.fn().mockResolvedValue(stored), insert }),
    );

    const result = await service.create("user_1", createRequest);

    expect(insert).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "conflict", current: stored });
  });
});

describe("createAreaService.listForAccount", () => {
  it("delegates to the repository", async () => {
    const listForAccount = vi.fn().mockResolvedValue([record()]);
    const service = createAreaService(repository({ listForAccount }));

    const result = await service.listForAccount("user_1");

    expect(listForAccount).toHaveBeenCalledWith("user_1");
    expect(result).toHaveLength(1);
  });
});
