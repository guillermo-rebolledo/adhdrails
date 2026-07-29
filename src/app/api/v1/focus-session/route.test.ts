import { describe, expect, it, vi } from "vitest";

import type { FocusSessionRecord } from "@/server/focus/repository";
import type { FocusStartResult } from "@/server/focus/service";

import { createFocusSessionRouteHandlers } from "./route";

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

function service(overrides: Record<string, unknown> = {}) {
  return {
    start: vi.fn(),
    transition: vi.fn(),
    getActive: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const post = (body?: unknown) =>
  new Request("https://rails.example/api/v1/focus-session", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const request = { id: ID, taskId: TASK_ID, idempotencyKey: KEY };

describe("POST /api/v1/focus-session", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { POST } = createFocusSessionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    expect((await POST(post(request))).status).toBe(401);
  });

  it("starts the account's session with 201", async () => {
    const start = vi.fn().mockResolvedValue({
      ok: true,
      item: record(),
      created: true,
    } satisfies FocusStartResult);
    const { POST } = createFocusSessionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ start }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post(request));

    expect(response.status).toBe(201);
    expect(start).toHaveBeenCalledWith("user_1", request);
    await expect(response.json()).resolves.toMatchObject({
      id: ID,
      status: "running",
    });
  });

  it("surfaces a competing session as 409 with the active session", async () => {
    const start = vi.fn().mockResolvedValue({
      ok: false,
      reason: "conflict",
      current: record({ id: "99999999-9999-4999-8999-999999999999" }),
    } satisfies FocusStartResult);
    const { POST } = createFocusSessionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ start }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post(request));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "conflict",
      current: { id: "99999999-9999-4999-8999-999999999999" },
    });
  });
});

describe("GET /api/v1/focus-session", () => {
  it("returns the active session for cross-device hydration", async () => {
    const getActive = vi.fn().mockResolvedValue(record());
    const { GET } = createFocusSessionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ getActive }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request("https://rails.example/api/v1/focus-session"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      session: { id: ID, status: "running" },
    });
  });

  it("returns a null session when none is active", async () => {
    const { GET } = createFocusSessionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request("https://rails.example/api/v1/focus-session"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session: null });
  });
});
