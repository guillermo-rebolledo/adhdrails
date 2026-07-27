import { describe, expect, it } from "vitest";

import { createUnknownApiRouteHandler } from "./route";

describe("unknown /api/v1 route", () => {
  it("returns a stable, human-safe Problem Details envelope", async () => {
    const response = createUnknownApiRouteHandler(() => "cor_not_found")(
      new Request("https://rails.example/api/v1/not-real"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      type: "https://rails.app/problems/not-found",
      title: "Not found",
      status: 404,
      code: "route_not_found",
      detail: "The requested API route does not exist.",
      correlationId: "cor_not_found",
      retryable: false,
    });
  });
});
