import { describe, expect, it, vi } from "vitest";

import type { TaskRecord } from "./repository";
import { createTaskService } from "./service";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-07-26T12:00:00.000Z");

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: ID,
    title: "Write the report",
    status: "active",
    scheduledDate: null,
    scheduledTime: null,
    estimateMinutes: null,
    energy: null,
    important: false,
    notes: "",
    areaId: null,
    completedAt: null,
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
    listActiveForAccount: vi.fn(),
    ...overrides,
  } as never;
}

const createRequest = {
  id: ID,
  title: "Write the report",
  idempotencyKey: KEY,
};

describe("createTaskService.create", () => {
  it("rejects an invalid create before touching the repository", async () => {
    const insert = vi.fn();
    const service = createTaskService(repository({ insert }));

    const result = await service.create("user_1", { id: "nope", title: "" });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts a fresh title-only task", async () => {
    const insert = vi.fn().mockResolvedValue(record());
    const service = createTaskService(repository({ insert }));

    const result = await service.create("user_1", createRequest);

    expect(insert).toHaveBeenCalledWith("user_1", createRequest);
    expect(result).toMatchObject({ ok: true, created: true });
  });

  it("replays a duplicate delivery without inserting again", async () => {
    const insert = vi.fn();
    const service = createTaskService(
      repository({ getById: vi.fn().mockResolvedValue(record()), insert }),
    );

    const result = await service.create("user_1", createRequest);

    expect(insert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, created: false });
  });

  it("passes planning metadata through to the repository on insert", async () => {
    const areaId = "33333333-3333-4333-8333-333333333333";
    const withMetadata = {
      ...createRequest,
      scheduledDate: "2026-08-01",
      scheduledTime: "09:30",
      estimateMinutes: 25,
      energy: "high",
      important: true,
      notes: "Draft first.",
      areaId,
    };
    const insert = vi.fn().mockResolvedValue(record(withMetadata));
    const service = createTaskService(repository({ insert }));

    const result = await service.create("user_1", withMetadata);

    expect(insert).toHaveBeenCalledWith("user_1", withMetadata);
    expect(result).toMatchObject({ ok: true, created: true });
  });

  it("rejects an incoherent schedule (time without date) before inserting", async () => {
    const insert = vi.fn();
    const service = createTaskService(repository({ insert }));

    const result = await service.create("user_1", {
      ...createRequest,
      scheduledTime: "09:30",
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses to reference an Area that is not the account's own", async () => {
    const areaId = "33333333-3333-4333-8333-333333333333";
    const insert = vi.fn();
    const service = createTaskService(
      repository({ insert }),
      () => NOW,
      async () => false,
    );

    const result = await service.create("user_1", { ...createRequest, areaId });

    expect(insert).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      fieldErrors: { areaId: expect.any(Array) },
    });
  });

  it("accepts a Task that references the account's own Area", async () => {
    const areaId = "33333333-3333-4333-8333-333333333333";
    const insert = vi.fn().mockResolvedValue(record({ areaId }));
    const areaCheck = vi.fn().mockResolvedValue(true);
    const service = createTaskService(
      repository({ insert }),
      () => NOW,
      areaCheck,
    );

    const result = await service.create("user_1", { ...createRequest, areaId });

    expect(areaCheck).toHaveBeenCalledWith("user_1", areaId);
    expect(result).toMatchObject({ ok: true, created: true });
  });

  it("refuses to resurrect a tombstoned task", async () => {
    const insert = vi.fn();
    const service = createTaskService(
      repository({
        isTombstoned: vi.fn().mockResolvedValue(true),
        insert,
      }),
    );

    const result = await service.create("user_1", createRequest);

    expect(insert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, reason: "gone" });
  });
});

describe("createTaskService.update", () => {
  const base = { idempotencyKey: KEY, baseVersion: 1 };

  it("completes an active task and stamps completedAt", async () => {
    const stored = record({ idempotencyKey: "prior" });
    const update = vi
      .fn()
      .mockResolvedValue(record({ status: "completed", completedAt: NOW }));
    const service = createTaskService(
      repository({ getById: vi.fn().mockResolvedValue(stored), update }),
      () => NOW,
    );

    const result = await service.update("user_1", ID, {
      ...base,
      patch: { status: "completed" },
    });

    expect(update).toHaveBeenCalledWith(
      "user_1",
      ID,
      expect.objectContaining({ completedAt: NOW, version: 2 }),
    );
    expect(result).toMatchObject({ ok: true, applied: true });
  });

  it("clears completedAt when returning a task to active", async () => {
    const stored = record({
      status: "completed",
      completedAt: NOW,
      idempotencyKey: "prior",
    });
    const update = vi.fn().mockResolvedValue(record());
    const service = createTaskService(
      repository({ getById: vi.fn().mockResolvedValue(stored), update }),
    );

    await service.update("user_1", ID, {
      ...base,
      patch: { status: "active" },
    });

    expect(update).toHaveBeenCalledWith(
      "user_1",
      ID,
      expect.objectContaining({ completedAt: null }),
    );
  });

  it("returns a reviewable conflict on a stale base version", async () => {
    const stored = record({ version: 5, idempotencyKey: "prior" });
    const update = vi.fn();
    const service = createTaskService(
      repository({ getById: vi.fn().mockResolvedValue(stored), update }),
    );

    const result = await service.update("user_1", ID, {
      ...base,
      patch: { title: "New title" },
    });

    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "conflict", current: stored });
  });

  it("replays a duplicate update mutation", async () => {
    const stored = record({ version: 3, idempotencyKey: KEY });
    const update = vi.fn();
    const service = createTaskService(
      repository({ getById: vi.fn().mockResolvedValue(stored), update }),
    );

    const result = await service.update("user_1", ID, {
      ...base,
      patch: { title: "New title" },
    });

    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, applied: false });
  });

  it("reports a missing task", async () => {
    const service = createTaskService(repository());

    const result = await service.update("user_1", ID, {
      ...base,
      patch: { title: "New title" },
    });

    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("refuses to patch in an Area that is not the account's own", async () => {
    const areaId = "33333333-3333-4333-8333-333333333333";
    const update = vi.fn();
    const service = createTaskService(
      repository({
        getById: vi.fn().mockResolvedValue(record({ idempotencyKey: "prior" })),
        update,
      }),
      () => NOW,
      async () => false,
    );

    const result = await service.update("user_1", ID, {
      ...base,
      patch: { areaId },
    });

    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("allows clearing the Area without an ownership check", async () => {
    const update = vi.fn().mockResolvedValue(record({ areaId: null }));
    const areaCheck = vi.fn();
    const service = createTaskService(
      repository({
        getById: vi.fn().mockResolvedValue(record({ idempotencyKey: "prior" })),
        update,
      }),
      () => NOW,
      areaCheck,
    );

    const result = await service.update("user_1", ID, {
      ...base,
      patch: { areaId: null },
    });

    expect(areaCheck).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, applied: true });
  });

  it("treats an update to a tombstoned task as gone", async () => {
    const service = createTaskService(
      repository({ isTombstoned: vi.fn().mockResolvedValue(true) }),
    );

    const result = await service.update("user_1", ID, {
      ...base,
      patch: { title: "New title" },
    });

    expect(result).toMatchObject({ ok: false, reason: "gone" });
  });
});

describe("createTaskService.remove", () => {
  it("delegates to the repository, which writes the tombstone", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = createTaskService(repository({ remove }));

    await service.remove("user_1", ID);

    expect(remove).toHaveBeenCalledWith("user_1", ID);
  });
});
