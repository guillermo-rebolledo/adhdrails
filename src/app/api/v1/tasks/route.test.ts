import { describe, expect, it, vi } from "vitest";

import type { TaskRecord } from "@/server/task/repository";
import type { TaskCreateResult } from "@/server/task/service";

import { createTasksRouteHandlers } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

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

function service(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listActiveForAccount: vi.fn().mockResolvedValue([]),
    listCollection: vi
      .fn()
      .mockResolvedValue({ ok: true, items: [], nextCursor: null }),
    ...overrides,
  };
}

const post = (body?: unknown) =>
  new Request("https://rails.example/api/v1/tasks", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const request = { id: ID, title: "Write the report", idempotencyKey: KEY };

describe("POST /api/v1/tasks", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { POST } = createTasksRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post(request));

    expect(response.status).toBe(401);
  });

  it("creates a title-only task with 201", async () => {
    const create = vi.fn().mockResolvedValue({
      ok: true,
      item: record(),
      created: true,
    } satisfies TaskCreateResult);
    const { POST } = createTasksRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ create }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post(request));

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith("user_1", request);
    await expect(response.json()).resolves.toMatchObject({
      id: ID,
      title: "Write the report",
      status: "active",
    });
  });

  it("refuses to resurrect a tombstoned task with 410", async () => {
    const create = vi.fn().mockResolvedValue({
      ok: false,
      reason: "gone",
    } satisfies TaskCreateResult);
    const { POST } = createTasksRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ create }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post(request));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ code: "gone" });
  });
});

describe("GET /api/v1/tasks", () => {
  it("lists a filtered cursor page for the signed-in account", async () => {
    const listCollection = vi.fn().mockResolvedValue({
      ok: true,
      items: [record()],
      nextCursor: "next-page",
    });
    const { GET } = createTasksRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ listCollection }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request(
        "https://rails.example/api/v1/tasks?collection=today&today=2026-07-27&energy=low&areaId=44444444-4444-4444-8444-444444444444&cursor=abc",
      ),
    );

    expect(response.status).toBe(200);
    expect(listCollection).toHaveBeenCalledWith(
      "user_1",
      {
        collection: "today",
        today: "2026-07-27",
        energy: "low",
        areaId: "44444444-4444-4444-8444-444444444444",
        cursor: "abc",
      },
      expect.any(Number),
    );
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: ID, title: "Write the report" }],
      nextCursor: "next-page",
    });
  });

  it("keeps the no-parameter endpoint compatible as the Anytime view", async () => {
    const listCollection = vi.fn().mockResolvedValue({
      ok: true,
      items: [record()],
      nextCursor: null,
    });
    const { GET } = createTasksRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ listCollection }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request("https://rails.example/api/v1/tasks"),
    );

    expect(response.status).toBe(200);
    expect(listCollection).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ collection: "anytime" }),
      expect.any(Number),
    );
  });

  it("returns 422 for invalid filters", async () => {
    const { GET } = createTasksRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () =>
        service({
          listCollection: vi.fn().mockResolvedValue({
            ok: false,
            reason: "invalid",
            fieldErrors: { collection: ["Invalid option."] },
          }),
        }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request("https://rails.example/api/v1/tasks?collection=overdue"),
    );

    expect(response.status).toBe(422);
  });
});
