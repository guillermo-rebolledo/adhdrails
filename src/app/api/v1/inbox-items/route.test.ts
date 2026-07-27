import { describe, expect, it, vi } from "vitest";

import type { InboxItemRecord } from "@/server/inbox/repository";
import type { InboxCaptureResult } from "@/server/inbox/service";

import { createInboxRouteHandlers } from "./route";

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

function service(overrides: Record<string, unknown> = {}) {
  return {
    capture: vi.fn(),
    listForAccount: vi.fn(),
    ...overrides,
  };
}

const post = (body?: unknown) =>
  new Request("https://rails.example/api/v1/inbox-items", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const request = { id: ID, title: "Buy milk", idempotencyKey: KEY };

describe("POST /api/v1/inbox-items", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { POST } = createInboxRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post(request));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "unauthorized",
    });
  });

  it("creates a capture scoped to the signed-in account with 201", async () => {
    const capture = vi.fn().mockResolvedValue({
      ok: true,
      item: record(),
      created: true,
    } satisfies InboxCaptureResult);
    const { POST } = createInboxRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ capture }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post(request));

    expect(response.status).toBe(201);
    expect(capture).toHaveBeenCalledWith("user_1", request);
    await expect(response.json()).resolves.toMatchObject({
      id: ID,
      title: "Buy milk",
      seen: false,
      version: 1,
    });
  });

  it("acknowledges an idempotent replay with 200", async () => {
    const capture = vi.fn().mockResolvedValue({
      ok: true,
      item: record(),
      created: false,
    } satisfies InboxCaptureResult);
    const { POST } = createInboxRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ capture }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post(request));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: ID });
  });

  it("maps an invalid capture to a validation problem", async () => {
    const capture = vi.fn().mockResolvedValue({
      ok: false,
      reason: "invalid",
      fieldErrors: { title: ["A capture needs a title."] },
    } satisfies InboxCaptureResult);
    const { POST } = createInboxRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ capture }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post({ id: ID, title: "" }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "validation_failed",
    });
  });

  it("returns a 409 conflict carrying the server's current record", async () => {
    const current = record({ title: "Buy bread" });
    const capture = vi.fn().mockResolvedValue({
      ok: false,
      reason: "conflict",
      current,
    } satisfies InboxCaptureResult);
    const { POST } = createInboxRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ capture }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post(request));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "conflict",
      current: { id: ID, title: "Buy bread" },
    });
  });
});

describe("GET /api/v1/inbox-items", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { GET } = createInboxRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request("https://rails.example/api/v1/inbox-items"),
    );

    expect(response.status).toBe(401);
  });

  it("lists the signed-in account's captures", async () => {
    const listForAccount = vi.fn().mockResolvedValue([record()]);
    const { GET } = createInboxRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ listForAccount }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request("https://rails.example/api/v1/inbox-items"),
    );

    expect(response.status).toBe(200);
    expect(listForAccount).toHaveBeenCalledWith("user_1");
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: ID, title: "Buy milk" }],
    });
  });
});
