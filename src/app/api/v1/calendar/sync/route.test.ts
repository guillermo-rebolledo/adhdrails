import { describe, expect, it, vi } from "vitest";

import type { CalendarImportService } from "@/server/calendar/import-service";
import type { CalendarWatchService } from "@/server/calendar/watch-service";

import { createCalendarSyncRouteHandlers } from "./route";

function service(
  importMirror: CalendarImportService["importMirror"],
): CalendarImportService {
  return { importMirror } as unknown as CalendarImportService;
}

/** A watch service that records `ensureWatches` calls; succeeds by default. */
function watchService(
  ensureWatches: CalendarWatchService["ensureWatches"] = vi
    .fn()
    .mockResolvedValue({ ok: true, registered: 1, skipped: 0 }),
): {
  getWatchService: () => CalendarWatchService;
  ensureWatches: typeof ensureWatches;
} {
  return {
    getWatchService: () => ({ ensureWatches }) as CalendarWatchService,
    ensureWatches,
  };
}

const post = () =>
  new Request("https://rails.example/api/v1/calendar/sync", { method: "POST" });

describe("POST /api/v1/calendar/sync", () => {
  it("returns 401 when unauthenticated", async () => {
    const { POST } = createCalendarSyncRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service(vi.fn()),
      getWatchService: watchService().getWatchService,
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
    const watch = watchService();
    const { POST } = createCalendarSyncRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () => service(importMirror),
      getWatchService: watch.getWatchService,
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
    // A successful import registers/renews the push-notification watches.
    expect(watch.ensureWatches).toHaveBeenCalledWith("u1");
  });

  it("still returns success when watch registration fails", async () => {
    const { POST } = createCalendarSyncRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () =>
        service(
          vi.fn().mockResolvedValue({
            ok: true,
            imported: 1,
            removed: 0,
            lastSyncedAt: "2026-07-27T12:00:00.000Z",
          }),
        ),
      getWatchService: watchService(
        vi.fn().mockRejectedValue(new Error("watch boom")),
      ).getWatchService,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post());
    expect(response.status).toBe(200);
  });

  it("maps a missing connection to 404", async () => {
    const { POST } = createCalendarSyncRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () =>
        service(
          vi.fn().mockResolvedValue({ ok: false, reason: "not_connected" }),
        ),
      getWatchService: watchService().getWatchService,
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
      getWatchService: watchService().getWatchService,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "calendar_reauth_required",
    });
  });
});
