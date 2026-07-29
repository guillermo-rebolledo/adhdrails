import { describe, expect, it, vi } from "vitest";

import type { FocusSessionRecord } from "@/server/focus/repository";
import type { FocusTransitionResult } from "@/server/focus/service";

import { createFocusSessionItemRouteHandlers } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const KEY = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-07-27T14:00:00.000Z");

function record(
  overrides: Partial<FocusSessionRecord> = {},
): FocusSessionRecord {
  return {
    id: ID,
    taskId: TASK_ID,
    status: "paused",
    accumulatedSeconds: 70,
    lastResumedAt: null,
    distractionCount: 0,
    startedAt: NOW,
    completedAt: null,
    version: 2,
    idempotencyKey: KEY,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function service(overrides: Record<string, unknown> = {}) {
  return { transition: vi.fn(), ...overrides };
}

const patch = (body: unknown) =>
  new Request(`https://rails.example/api/v1/focus-session/${ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const transitionBody = {
  idempotencyKey: KEY,
  baseVersion: 1,
  status: "paused",
  accumulatedSeconds: 70,
  lastResumedAt: null,
  completedAt: null,
};

describe("PATCH /api/v1/focus-session/[id]", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { PATCH } = createFocusSessionItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    expect((await PATCH(patch(transitionBody), ID)).status).toBe(401);
  });

  it("applies a transition and returns the updated session", async () => {
    const transition = vi.fn().mockResolvedValue({
      ok: true,
      item: record(),
      applied: true,
    } satisfies FocusTransitionResult);
    const { PATCH } = createFocusSessionItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ transition }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(patch(transitionBody), ID);

    expect(response.status).toBe(200);
    expect(transition).toHaveBeenCalledWith("user_1", ID, transitionBody);
    await expect(response.json()).resolves.toMatchObject({
      id: ID,
      status: "paused",
    });
  });

  it("keeps a stale transition as 409 with the server's session", async () => {
    const transition = vi.fn().mockResolvedValue({
      ok: false,
      reason: "conflict",
      current: record({ status: "completed", version: 5 }),
    } satisfies FocusTransitionResult);
    const { PATCH } = createFocusSessionItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ transition }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(patch(transitionBody), ID);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "conflict",
      current: { status: "completed" },
    });
  });

  it("returns 404 for a session that does not exist", async () => {
    const transition = vi.fn().mockResolvedValue({
      ok: false,
      reason: "not_found",
    } satisfies FocusTransitionResult);
    const { PATCH } = createFocusSessionItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ transition }) as never,
      createCorrelationId: () => "cor_1",
    });

    expect((await PATCH(patch(transitionBody), ID)).status).toBe(404);
  });
});
