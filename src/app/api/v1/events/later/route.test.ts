import { describe, expect, it, vi } from "vitest";

import { createLaterEventsRouteHandlers } from "./route";

function service(overrides: Record<string, unknown> = {}) {
  return {
    listLater: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    ...overrides,
  };
}

describe("GET /api/v1/events/later", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { GET } = createLaterEventsRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request(
        "https://rails.example/api/v1/events/later?from=2026-07-27T04:00:00Z",
      ),
    );

    expect(response.status).toBe(401);
  });

  it("rejects a missing `from` with 422", async () => {
    const { GET } = createLaterEventsRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request("https://rails.example/api/v1/events/later"),
    );

    expect(response.status).toBe(422);
  });

  it("returns a page with its next cursor", async () => {
    const listLater = vi.fn().mockResolvedValue({
      items: [],
      nextCursor: "cursor-token",
    });
    const { GET } = createLaterEventsRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ listLater }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request(
        "https://rails.example/api/v1/events/later?from=2026-07-27T04:00:00Z&cursor=abc",
      ),
    );

    expect(response.status).toBe(200);
    expect(listLater).toHaveBeenCalledWith(
      "user_1",
      new Date("2026-07-27T04:00:00Z"),
      "abc",
      expect.any(Number),
    );
    await expect(response.json()).resolves.toMatchObject({
      nextCursor: "cursor-token",
    });
  });
});
