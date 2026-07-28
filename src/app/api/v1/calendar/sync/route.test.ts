import { describe, expect, it, vi } from "vitest";

import type { CalendarImportService } from "@/server/calendar/import-service";

import { createCalendarSyncRouteHandlers } from "./route";

function service(
  importMirror: CalendarImportService["importMirror"],
): CalendarImportService {
  return { importMirror } as unknown as CalendarImportService;
}

const post = () =>
  new Request("https://rails.example/api/v1/calendar/sync", { method: "POST" });

describe("POST /api/v1/calendar/sync", () => {
  it("returns 401 when unauthenticated", async () => {
    const { POST } = createCalendarSyncRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service(vi.fn()),
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post());
    expect(response.status).toBe(401);
  });

  it("returns the import counts and last-synced instant on success", async () => {
    const importMirror = vi.fn().mockResolvedValue({
      ok: true,
      imported: 3,
      removed: 1,
      lastSyncedAt: "2026-07-27T12:00:00.000Z",
    });
    const { POST } = createCalendarSyncRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () => service(importMirror),
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      imported: 3,
      removed: 1,
      lastSyncedAt: "2026-07-27T12:00:00.000Z",
    });
    expect(importMirror).toHaveBeenCalledWith("u1");
  });

  it("maps a missing connection to 404", async () => {
    const { POST } = createCalendarSyncRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () =>
        service(
          vi.fn().mockResolvedValue({ ok: false, reason: "not_connected" }),
        ),
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post());
    expect(response.status).toBe(404);
  });

  it("maps a failed token refresh to a 403 reconnect problem", async () => {
    const { POST } = createCalendarSyncRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () =>
        service(
          vi.fn().mockResolvedValue({ ok: false, reason: "unauthorized" }),
        ),
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "calendar_reauth_required",
    });
  });
});
