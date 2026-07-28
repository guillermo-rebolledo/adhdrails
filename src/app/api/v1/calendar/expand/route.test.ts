import { describe, expect, it, vi } from "vitest";

import type { CalendarMaintenanceService } from "@/server/calendar/maintenance-service";

import { createCalendarExpandRouteHandlers } from "./route";

function service(
  expandForAccount: CalendarMaintenanceService["expandForAccount"],
): CalendarMaintenanceService {
  return { expandForAccount } as unknown as CalendarMaintenanceService;
}

function post(body?: unknown): Request {
  return new Request("https://rails.example/api/v1/calendar/expand", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/v1/calendar/expand", () => {
  it("returns 401 when unauthenticated", async () => {
    const { POST } = createCalendarExpandRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service(vi.fn()),
      createCorrelationId: () => "cor_1",
    });

    expect(
      (await POST(post({ through: "2028-01-01T00:00:00.000Z" }))).status,
    ).toBe(401);
  });

  it("maps an invalid request body to a 422 validation problem", async () => {
    const { POST } = createCalendarExpandRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () =>
        service(
          vi.fn().mockResolvedValue({
            ok: false,
            reason: "invalid_shape",
            fieldErrors: {
              through: ["A valid `through` instant is required."],
            },
          }),
        ),
      createCorrelationId: () => "cor_1",
    });

    expect((await POST(post({ through: "not-a-date" }))).status).toBe(422);
  });

  it("expands through the requested instant and returns the counts", async () => {
    const expandForAccount = vi.fn().mockResolvedValue({
      ok: true,
      calendars: 2,
      changed: 5,
      removed: 1,
      failures: 0,
    });
    const { POST } = createCalendarExpandRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () => service(expandForAccount),
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post({ through: "2028-01-01T00:00:00.000Z" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      calendars: 2,
      changed: 5,
      removed: 1,
    });
    // The route delegates the parsed body straight to the service.
    expect(expandForAccount).toHaveBeenCalledWith("u1", {
      through: "2028-01-01T00:00:00.000Z",
    });
  });

  it("maps a missing connection to 404", async () => {
    const { POST } = createCalendarExpandRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () =>
        service(
          vi.fn().mockResolvedValue({ ok: false, reason: "not_connected" }),
        ),
      createCorrelationId: () => "cor_1",
    });

    expect(
      (await POST(post({ through: "2028-01-01T00:00:00.000Z" }))).status,
    ).toBe(404);
  });
});
