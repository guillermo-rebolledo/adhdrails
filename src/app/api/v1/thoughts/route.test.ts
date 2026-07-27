import { describe, expect, it, vi } from "vitest";

import type { ThoughtRecord } from "@/server/thought/repository";

import { createThoughtCollectionHandlers } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

function record(): ThoughtRecord {
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
  };
}

function handlers(account: { userId: string } | null, service: object) {
  return createThoughtCollectionHandlers({
    getAccountSummary: vi.fn().mockResolvedValue(account),
    getService: () => service as never,
    createCorrelationId: () => "cor_1",
  });
}

describe("/api/v1/thoughts", () => {
  it("rejects unauthenticated reads and writes", async () => {
    const { GET, POST } = handlers(null, {});
    expect(
      (await GET(new Request("https://rails.example/api/v1/thoughts"))).status,
    ).toBe(401);
    expect(
      (
        await POST(
          new Request("https://rails.example/api/v1/thoughts", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("creates and lists Thoughts through the signed-in account scope", async () => {
    const create = vi.fn().mockResolvedValue({
      ok: true,
      thought: record(),
      created: true,
    });
    const listForAccount = vi.fn().mockResolvedValue([record()]);
    const { GET, POST } = handlers(
      { userId: "user_1" },
      { create, listForAccount },
    );

    const response = await POST(
      new Request("https://rails.example/api/v1/thoughts", {
        method: "POST",
        body: JSON.stringify({
          id: ID,
          title: "Reference",
          body: "Useful detail",
          sourceInboxItemId: null,
          idempotencyKey: KEY,
        }),
      }),
    );
    const list = await GET(
      new Request("https://rails.example/api/v1/thoughts"),
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith("user_1", expect.any(Object));
    expect(listForAccount).toHaveBeenCalledWith("user_1");
    await expect(list.json()).resolves.toMatchObject({
      thoughts: [{ id: ID, title: "Reference" }],
    });
  });
});
