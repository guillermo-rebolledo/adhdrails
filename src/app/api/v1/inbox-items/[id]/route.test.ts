import { describe, expect, it, vi } from "vitest";

import type { InboxItemRecord } from "@/server/inbox/repository";
import type { InboxUpdateResult } from "@/server/inbox/service";

import { createInboxItemRouteHandlers } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

function record(overrides: Partial<InboxItemRecord> = {}): InboxItemRecord {
  return {
    id: ID,
    title: "Buy milk",
    seenAt: new Date("2026-07-27T12:00:00.000Z"),
    version: 2,
    idempotencyKey: KEY,
    createdAt: new Date("2026-07-26T10:00:00.000Z"),
    updatedAt: new Date("2026-07-27T12:00:00.000Z"),
    ...overrides,
  };
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    capture: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listForAccount: vi.fn(),
    ...overrides,
  };
}

const patch = (body?: unknown) =>
  new Request(`https://rails.example/api/v1/inbox-items/${ID}`, {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const del = () =>
  new Request(`https://rails.example/api/v1/inbox-items/${ID}`, {
    method: "DELETE",
  });

const updateRequest = {
  idempotencyKey: KEY,
  baseVersion: 1,
  patch: { seen: true },
};

describe("PATCH /api/v1/inbox-items/:id", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { PATCH } = createInboxItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(patch(updateRequest), ID);

    expect(response.status).toBe(401);
  });

  it("marks an item seen and returns the updated record", async () => {
    const update = vi.fn().mockResolvedValue({
      ok: true,
      item: record(),
      applied: true,
    } satisfies InboxUpdateResult);
    const { PATCH } = createInboxItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ update }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(patch(updateRequest), ID);

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith("user_1", ID, updateRequest);
    await expect(response.json()).resolves.toMatchObject({
      id: ID,
      seen: true,
      version: 2,
    });
  });

  it("maps a stale update to a 409 conflict carrying the server record", async () => {
    const update = vi.fn().mockResolvedValue({
      ok: false,
      reason: "conflict",
      current: record({ version: 5 }),
    } satisfies InboxUpdateResult);
    const { PATCH } = createInboxItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ update }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(patch(updateRequest), ID);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "conflict",
      current: { version: 5 },
    });
  });

  it("maps a tombstoned update to a 410 gone", async () => {
    const update = vi.fn().mockResolvedValue({
      ok: false,
      reason: "gone",
    } satisfies InboxUpdateResult);
    const { PATCH } = createInboxItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ update }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(patch(updateRequest), ID);

    expect(response.status).toBe(410);
  });
});

describe("DELETE /api/v1/inbox-items/:id", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { DELETE } = createInboxItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await DELETE(del(), ID);

    expect(response.status).toBe(401);
  });

  it("deletes the item scoped to the signed-in account", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const { DELETE } = createInboxItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ remove }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await DELETE(del(), ID);

    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith("user_1", ID);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
