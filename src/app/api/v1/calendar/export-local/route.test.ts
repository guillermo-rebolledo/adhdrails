import { describe, expect, it, vi } from "vitest";

import { createExportLocalRouteHandlers } from "./route";

function handlers(overrides: Record<string, unknown> = {}) {
  return createExportLocalRouteHandlers({
    getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
    getService: () =>
      ({
        exportLocalEvents: vi.fn().mockResolvedValue({ ok: true, enqueued: 3 }),
        ...overrides,
      }) as never,
    createCorrelationId: () => "cor_1",
  });
}

const request = () =>
  new Request("https://rails.example/api/v1/calendar/export-local", {
    method: "POST",
  });

describe("POST /api/v1/calendar/export-local", () => {
  it("returns 401 when unauthenticated", async () => {
    const { POST } = createExportLocalRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => ({ exportLocalEvents: vi.fn() }) as never,
      createCorrelationId: () => "cor_1",
    });

    expect((await POST(request())).status).toBe(401);
  });

  it("enqueues exports and returns the count", async () => {
    const { POST } = handlers();

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ enqueued: 3 });
  });

  it("returns 404 when no writable calendar is selected", async () => {
    const { POST } = handlers({
      exportLocalEvents: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "no_writable_calendar" }),
    });

    const response = await POST(request());

    expect(response.status).toBe(404);
  });
});
