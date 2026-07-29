import { describe, expect, it, vi } from "vitest";

import type { CalendarService } from "@/server/calendar/service";

import { createCalendarSelectionRouteHandlers } from "./route";

function service(overrides: Partial<CalendarService> = {}): CalendarService {
  return {
    buildAuthorizationUrl: vi.fn(),
    completeAuthorization: vi.fn(),
    getConnection: vi.fn(),
    saveSelection: vi.fn(),
    disconnect: vi.fn(),
    ...overrides,
  } as unknown as CalendarService;
}

const put = (body: unknown) =>
  new Request("https://rails.example/api/v1/calendar/selection", {
    method: "PUT",
    body: JSON.stringify(body),
  });

describe("PUT /api/v1/calendar/selection", () => {
  it("returns 401 when unauthenticated", async () => {
    const { PUT } = createCalendarSelectionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service(),
      createCorrelationId: () => "cor_1",
    });

    const response = await PUT(put({ selections: [] }));
    expect(response.status).toBe(401);
  });

  it("maps a read-only writable choice to a validation problem", async () => {
    const saveSelection = vi.fn().mockResolvedValue({
      ok: false,
      reason: "invalid",
      validation: { ok: false, reason: "readonly_writable" },
    });
    const { PUT } = createCalendarSelectionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () => service({ saveSelection }),
      createCorrelationId: () => "cor_1",
    });

    const response = await PUT(
      put({
        selections: [
          { googleCalendarId: "shared", isVisible: true, isWritable: true },
        ],
      }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      code: string;
      fieldErrors: Record<string, string[]>;
    };
    expect(body.code).toBe("validation_failed");
    expect(body.fieldErrors.selections[0]).toMatch(/read-only/i);
  });

  it("returns 404 when Calendar is not connected", async () => {
    const saveSelection = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "not_connected" });
    const { PUT } = createCalendarSelectionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () => service({ saveSelection }),
      createCorrelationId: () => "cor_1",
    });

    const response = await PUT(put({ selections: [] }));
    expect(response.status).toBe(404);
  });

  it("saves a valid selection and returns the calendars", async () => {
    const saveSelection = vi
      .fn()
      .mockResolvedValue({ ok: true, calendars: [{ googleCalendarId: "a" }] });
    const { PUT } = createCalendarSelectionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () => service({ saveSelection }),
      createCorrelationId: () => "cor_1",
    });

    const response = await PUT(
      put({
        selections: [
          { googleCalendarId: "a", isVisible: true, isWritable: true },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(saveSelection).toHaveBeenCalledWith("u1", {
      selections: [
        { googleCalendarId: "a", isVisible: true, isWritable: true },
      ],
    });
  });
});
