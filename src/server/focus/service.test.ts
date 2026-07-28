import { describe, expect, it, vi } from "vitest";

import type { FocusSessionRecord } from "./repository";
import { createFocusSessionService } from "./service";

const ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const KEY = "22222222-2222-4222-8222-222222222222";
const OTHER_KEY = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-07-27T14:00:00.000Z");

function record(
  overrides: Partial<FocusSessionRecord> = {},
): FocusSessionRecord {
  return {
    id: ID,
    taskId: TASK_ID,
    status: "running",
    accumulatedSeconds: 0,
    lastResumedAt: NOW,
    distractionCount: 0,
    startedAt: NOW,
    completedAt: null,
    version: 1,
    idempotencyKey: KEY,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    getById: vi.fn().mockResolvedValue(null),
    getActive: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
    update: vi.fn(),
    ...overrides,
  } as never;
}

const startRequest = { id: ID, taskId: TASK_ID, idempotencyKey: KEY };

describe("createFocusSessionService.start", () => {
  it("rejects an invalid start before touching the repository", async () => {
    const insert = vi.fn();
    const service = createFocusSessionService(repository({ insert }));

    const result = await service.start("user_1", { id: "nope" });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a Task the account does not own", async () => {
    const insert = vi.fn();
    const service = createFocusSessionService(
      repository({ insert }),
      () => NOW,
      async () => false,
    );

    const result = await service.start("user_1", startRequest);

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts a running session when none is active", async () => {
    const inserted = record();
    const insert = vi.fn().mockResolvedValue(inserted);
    const service = createFocusSessionService(
      repository({ insert }),
      () => NOW,
    );

    const result = await service.start("user_1", startRequest);

    expect(result).toEqual({ ok: true, item: inserted, created: true });
    expect(insert).toHaveBeenCalledWith("user_1", {
      id: ID,
      taskId: TASK_ID,
      idempotencyKey: KEY,
      startedAt: NOW,
      lastResumedAt: NOW,
    });
  });

  it("replays an idempotent retry without inserting again", async () => {
    const existing = record();
    const insert = vi.fn();
    const service = createFocusSessionService(
      repository({ getById: vi.fn().mockResolvedValue(existing), insert }),
      () => NOW,
    );

    const result = await service.start("user_1", startRequest);

    expect(result).toEqual({ ok: true, item: existing, created: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("surfaces a competing active session as a conflict", async () => {
    const other = record({
      id: "99999999-9999-4999-8999-999999999999",
      idempotencyKey: OTHER_KEY,
    });
    const insert = vi.fn();
    const service = createFocusSessionService(
      repository({ getActive: vi.fn().mockResolvedValue(other), insert }),
      () => NOW,
    );

    const result = await service.start("user_1", startRequest);

    expect(result).toEqual({ ok: false, reason: "conflict", current: other });
    expect(insert).not.toHaveBeenCalled();
  });

  it("resolves a concurrent double-start race to the winning session", async () => {
    const winner = record({
      id: "99999999-9999-4999-8999-999999999999",
      idempotencyKey: OTHER_KEY,
    });
    const insert = vi.fn().mockRejectedValue({ code: "23505" });
    const getActive = vi
      .fn()
      .mockResolvedValueOnce(null) // pre-insert: looked clear
      .mockResolvedValueOnce(winner); // post-violation: another device won
    const service = createFocusSessionService(
      repository({ getActive, insert }),
      () => NOW,
    );

    const result = await service.start("user_1", startRequest);

    expect(result).toEqual({ ok: false, reason: "conflict", current: winner });
  });
});

describe("createFocusSessionService.transition", () => {
  const pauseRequest = {
    idempotencyKey: OTHER_KEY,
    baseVersion: 1,
    status: "paused" as const,
    accumulatedSeconds: 70,
    lastResumedAt: null,
    completedAt: null,
  };

  it("reports a missing session", async () => {
    const service = createFocusSessionService(repository());

    const result = await service.transition("user_1", ID, pauseRequest);

    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("persists the client's new state and bumps the version", async () => {
    const existing = record({ version: 1 });
    const updated = record({
      status: "paused",
      version: 2,
      accumulatedSeconds: 70,
      lastResumedAt: null,
    });
    const update = vi.fn().mockResolvedValue(updated);
    const service = createFocusSessionService(
      repository({ getById: vi.fn().mockResolvedValue(existing), update }),
      () => NOW,
    );

    const result = await service.transition("user_1", ID, pauseRequest);

    expect(result).toEqual({ ok: true, item: updated, applied: true });
    expect(update).toHaveBeenCalledWith("user_1", ID, {
      status: "paused",
      accumulatedSeconds: 70,
      lastResumedAt: null,
      completedAt: null,
      version: 2,
      idempotencyKey: OTHER_KEY,
    });
  });

  it("replays a transition already applied", async () => {
    const existing = record({
      version: 2,
      status: "paused",
      idempotencyKey: OTHER_KEY,
    });
    const update = vi.fn();
    const service = createFocusSessionService(
      repository({ getById: vi.fn().mockResolvedValue(existing), update }),
      () => NOW,
    );

    const result = await service.transition("user_1", ID, pauseRequest);

    expect(result).toEqual({ ok: true, item: existing, applied: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps a stale transition as a conflict", async () => {
    const existing = record({ version: 5 });
    const update = vi.fn();
    const service = createFocusSessionService(
      repository({ getById: vi.fn().mockResolvedValue(existing), update }),
      () => NOW,
    );

    const result = await service.transition("user_1", ID, pauseRequest);

    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      current: existing,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to rewrite a session completed elsewhere", async () => {
    const existing = record({ status: "completed", version: 1 });
    const update = vi.fn();
    const service = createFocusSessionService(
      repository({ getById: vi.fn().mockResolvedValue(existing), update }),
      () => NOW,
    );

    const result = await service.transition("user_1", ID, pauseRequest);

    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      current: existing,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("completes and records the terminal timing", async () => {
    const existing = record({ version: 1 });
    const completed = record({ status: "completed", version: 2 });
    const update = vi.fn().mockResolvedValue(completed);
    const service = createFocusSessionService(
      repository({ getById: vi.fn().mockResolvedValue(existing), update }),
      () => NOW,
    );

    const result = await service.transition("user_1", ID, {
      idempotencyKey: OTHER_KEY,
      baseVersion: 1,
      status: "completed",
      accumulatedSeconds: 120,
      lastResumedAt: null,
      completedAt: NOW.toISOString(),
    });

    expect(result).toEqual({ ok: true, item: completed, applied: true });
    expect(update).toHaveBeenCalledWith("user_1", ID, {
      status: "completed",
      accumulatedSeconds: 120,
      lastResumedAt: null,
      completedAt: NOW,
      version: 2,
      idempotencyKey: OTHER_KEY,
    });
  });
});
