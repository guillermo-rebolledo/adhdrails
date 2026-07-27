import { describe, expect, it, vi } from "vitest";

import { createHealthHandler } from "./route";

describe("GET /api/v1/health", () => {
  it("reports application and database readiness without leaking connection details", async () => {
    const response = await createHealthHandler({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      createCorrelationId: () => "cor_test_123",
    })(new Request("https://rails.example/api/v1/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("cor_test_123");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      checks: {
        application: "ok",
        database: "ok",
      },
      correlationId: "cor_test_123",
    });
  });

  it("returns a safe Problem Details response when PostgreSQL is unavailable", async () => {
    const response = await createHealthHandler({
      checkDatabase: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "connect ECONNREFUSED postgres://rails:secret@database.example",
          ),
        ),
      createCorrelationId: () => "cor_test_456",
    })(new Request("https://rails.example/api/v1/health"));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toEqual({
      type: "https://rails.app/problems/database-unavailable",
      title: "Service unavailable",
      status: 503,
      code: "database_unavailable",
      detail: "Rails cannot reach its database right now.",
      correlationId: "cor_test_456",
      retryable: true,
    });
  });
});
