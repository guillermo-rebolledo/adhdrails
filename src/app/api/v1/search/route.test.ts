import { describe, expect, it, vi } from "vitest";

import { createSearchRouteHandler } from "./route";

const request = (body: unknown) =>
  new Request("https://rails.example/api/v1/search", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST /api/v1/search", () => {
  it("requires an authenticated account", async () => {
    const POST = createSearchRouteHandler({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      search: vi.fn(),
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(request({ query: "report" }));

    expect(response.status).toBe(401);
  });

  it("searches only within the authenticated account without exposing the query to logs", async () => {
    const search = vi.fn().mockResolvedValue({
      items: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          type: "task",
          title: "Quarterly report",
          excerpt: "Draft",
          href: "/tasks/10000000-0000-4000-8000-000000000001/edit",
        },
      ],
      nextCursor: null,
    });
    const POST = createSearchRouteHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "owner" }),
      search,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(
      request({ query: "private report", cursor: "next" }),
    );

    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith("owner", {
      query: "private report",
      cursor: "next",
    });
    await expect(response.json()).resolves.toMatchObject({
      items: [{ type: "task", title: "Quarterly report" }],
      nextCursor: null,
    });
  });

  it("rejects blank and overlong queries", async () => {
    const search = vi.fn();
    const POST = createSearchRouteHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "owner" }),
      search,
      createCorrelationId: () => "cor_1",
    });

    const blank = await POST(request({ query: "  " }));
    const long = await POST(request({ query: "x".repeat(201) }));

    expect(blank.status).toBe(422);
    expect(long.status).toBe(422);
    expect(search).not.toHaveBeenCalled();
  });
});
