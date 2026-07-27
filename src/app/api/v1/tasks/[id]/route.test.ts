import { describe, expect, it, vi } from "vitest";

import type { TaskRecord } from "@/server/task/repository";
import type { TaskUpdateResult } from "@/server/task/service";

import { createTaskItemRouteHandlers } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: ID,
    title: "Write the report",
    status: "active",
    completedAt: null,
    version: 1,
    idempotencyKey: KEY,
    createdAt: new Date("2026-07-26T10:00:00.000Z"),
    updatedAt: new Date("2026-07-26T10:00:00.000Z"),
    ...overrides,
  };
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    listActiveForAccount: vi.fn(),
    ...overrides,
  };
}

const patch = (body: unknown) =>
  new Request(`https://rails.example/api/v1/tasks/${ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const del = () =>
  new Request(`https://rails.example/api/v1/tasks/${ID}`, { method: "DELETE" });

const updateBody = {
  idempotencyKey: KEY,
  baseVersion: 1,
  patch: { status: "completed" },
};

describe("PATCH /api/v1/tasks/[id]", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { PATCH } = createTaskItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    expect((await PATCH(patch(updateBody), ID)).status).toBe(401);
  });

  it("applies an update scoped to the account", async () => {
    const update = vi.fn().mockResolvedValue({
      ok: true,
      item: record({ status: "completed", version: 2 }),
      applied: true,
    } satisfies TaskUpdateResult);
    const { PATCH } = createTaskItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ update }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(patch(updateBody), ID);

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith("user_1", ID, updateBody);
    await expect(response.json()).resolves.toMatchObject({
      status: "completed",
      version: 2,
    });
  });

  it("returns a 409 conflict carrying the server's current task", async () => {
    const current = record({ version: 5, title: "Server title" });
    const update = vi.fn().mockResolvedValue({
      ok: false,
      reason: "conflict",
      current,
    } satisfies TaskUpdateResult);
    const { PATCH } = createTaskItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ update }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(patch(updateBody), ID);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "conflict",
      current: { version: 5, title: "Server title" },
    });
  });

  it("maps a gone task to 410", async () => {
    const update = vi.fn().mockResolvedValue({
      ok: false,
      reason: "gone",
    } satisfies TaskUpdateResult);
    const { PATCH } = createTaskItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ update }) as never,
      createCorrelationId: () => "cor_1",
    });

    expect((await PATCH(patch(updateBody), ID)).status).toBe(410);
  });
});

describe("DELETE /api/v1/tasks/[id]", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { DELETE } = createTaskItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    expect((await DELETE(del(), ID)).status).toBe(401);
  });

  it("removes the task and acknowledges idempotently", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const { DELETE } = createTaskItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ remove }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await DELETE(del(), ID);

    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith("user_1", ID);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });
});
