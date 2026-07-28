import { describe, expect, it, vi } from "vitest";

import { mirrorWindow } from "@/domain/calendar/import";
import { reconciliationCutoff } from "@/domain/calendar/maintenance";
import type { EventRepository } from "@/server/event/repository";
import type { EventExportJobRepository } from "@/server/event/export-job-repository";

import type { IncrementalSyncService } from "./incremental-sync-service";
import { createCalendarMaintenanceService } from "./maintenance-service";
import type { CalendarRepository } from "./repository";
import type { CalendarSyncJobRepository } from "./sync-job-repository";
import type { CalendarWatchService } from "./watch-service";
import type { EnsureWatchesResult } from "./watch-service";

const NOW = new Date("2026-07-28T12:00:00.000Z");

type SyncResult = Awaited<ReturnType<IncrementalSyncService["syncCalendar"]>>;
type ExpandResult = Awaited<ReturnType<IncrementalSyncService["expandWindow"]>>;

interface Overrides {
  connectedUserIds?: string[];
  dueCalendars?: { userId: string; googleCalendarId: string }[];
  visibleCalendars?: { googleCalendarId: string }[];
  hasConnection?: boolean;
  ensureWatches?: (userId: string) => Promise<EnsureWatchesResult>;
  syncCalendar?: (userId: string, calendarId: string) => Promise<SyncResult>;
  expandWindow?: (
    userId: string,
    calendarId: string,
    through: string,
  ) => Promise<ExpandResult>;
  removeMirrorOutsideWindow?: (userId: string) => Promise<number>;
  purgeSync?: number;
  purgeExport?: number;
}

function build(overrides: Overrides = {}) {
  const removeCalls: { userId: string; timeMin: Date; timeMax: Date }[] = [];
  const purgeCalls: { sync: Date | null; export: Date | null } = {
    sync: null,
    export: null,
  };

  const calendarRepository = {
    async listConnectedUserIds() {
      return overrides.connectedUserIds ?? [];
    },
    async listCalendarsDueForReconciliation() {
      return overrides.dueCalendars ?? [];
    },
    async getConnection() {
      return overrides.hasConnection === false ? null : ({} as never);
    },
    async listVisibleCalendarSyncState() {
      return (overrides.visibleCalendars ?? []) as never;
    },
  } as unknown as CalendarRepository;

  const eventRepository = {
    async removeMirrorOutsideWindow(
      userId: string,
      timeMin: Date,
      timeMax: Date,
    ) {
      removeCalls.push({ userId, timeMin, timeMax });
      return overrides.removeMirrorOutsideWindow
        ? overrides.removeMirrorOutsideWindow(userId)
        : 0;
    },
  } as unknown as EventRepository;

  const syncJobRepository = {
    async purgeResolvedBefore(cutoff: Date) {
      purgeCalls.sync = cutoff;
      return overrides.purgeSync ?? 0;
    },
  } as unknown as CalendarSyncJobRepository;

  const exportJobRepository = {
    async purgeResolvedBefore(cutoff: Date) {
      purgeCalls.export = cutoff;
      return overrides.purgeExport ?? 0;
    },
  } as unknown as EventExportJobRepository;

  const ensureWatches = vi.fn(
    overrides.ensureWatches ??
      (async () =>
        ({ ok: true, registered: 1, skipped: 0 }) as EnsureWatchesResult),
  );
  const watchService = { ensureWatches } as unknown as CalendarWatchService;

  const syncCalendar = vi.fn(
    overrides.syncCalendar ??
      (async () =>
        ({
          ok: true,
          changed: 0,
          removed: 0,
          recovered: false,
          lastSyncedAt: NOW.toISOString(),
        }) as SyncResult),
  );
  const expandWindow = vi.fn(
    overrides.expandWindow ??
      (async () => ({ ok: true, changed: 0, removed: 0 }) as ExpandResult),
  );
  const incrementalSyncService = {
    syncCalendar,
    expandWindow,
  } as unknown as IncrementalSyncService;

  const service = createCalendarMaintenanceService({
    calendarRepository,
    eventRepository,
    syncJobRepository,
    exportJobRepository,
    watchService,
    incrementalSyncService,
    now: () => NOW,
  });

  return {
    service,
    ensureWatches,
    syncCalendar,
    expandWindow,
    removeCalls,
    purgeCalls,
  };
}

describe("renewWatches", () => {
  it("renews every connected account and aggregates the counts", async () => {
    const { service, ensureWatches } = build({
      connectedUserIds: ["a", "b"],
      ensureWatches: async () => ({ ok: true, registered: 2, skipped: 1 }),
    });

    const result = await service.renewWatches();

    expect(result).toEqual({
      accounts: 2,
      registered: 4,
      skipped: 2,
      failures: 0,
      reauth: 0,
    });
    expect(ensureWatches.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });

  it("isolates a failure and classifies a lost grant as reauth, not failure", async () => {
    const { service } = build({
      connectedUserIds: ["ok", "throws", "reauth"],
      ensureWatches: async (userId) => {
        if (userId === "throws") {
          throw new Error("google down");
        }
        if (userId === "reauth") {
          return { ok: false, reason: "unauthorized" };
        }
        return { ok: true, registered: 1, skipped: 0 };
      },
    });

    const result = await service.renewWatches();

    // The thrown error is a transient failure; the lost grant is a reauth.
    expect(result).toEqual({
      accounts: 3,
      registered: 1,
      skipped: 0,
      failures: 1,
      reauth: 1,
    });
  });
});

describe("reconcile", () => {
  it("resyncs due calendars and aggregates changes and recoveries", async () => {
    const { service, syncCalendar } = build({
      dueCalendars: [
        { userId: "u1", googleCalendarId: "c1" },
        { userId: "u1", googleCalendarId: "c2" },
      ],
      syncCalendar: async (_userId, calendarId) =>
        calendarId === "c1"
          ? {
              ok: true,
              changed: 3,
              removed: 1,
              recovered: true,
              lastSyncedAt: NOW.toISOString(),
            }
          : {
              ok: true,
              changed: 1,
              removed: 0,
              recovered: false,
              lastSyncedAt: NOW.toISOString(),
            },
    });

    const result = await service.reconcile();

    expect(result).toEqual({
      due: 2,
      reconciled: 2,
      changed: 4,
      removed: 1,
      recovered: 1,
      failures: 0,
      reauth: 0,
    });
    expect(syncCalendar).toHaveBeenCalledTimes(2);
  });

  it("isolates a partial-calendar failure so the rest still reconcile", async () => {
    const { service } = build({
      dueCalendars: [
        { userId: "u1", googleCalendarId: "bad" },
        { userId: "u1", googleCalendarId: "reauth" },
        { userId: "u1", googleCalendarId: "good" },
      ],
      syncCalendar: async (_userId, calendarId) => {
        if (calendarId === "bad") {
          throw new Error("transient");
        }
        if (calendarId === "reauth") {
          return { ok: false, reason: "unauthorized" };
        }
        return {
          ok: true,
          changed: 2,
          removed: 0,
          recovered: false,
          lastSyncedAt: NOW.toISOString(),
        };
      },
    });

    const result = await service.reconcile();

    // The thrown error is a failure; the lost grant is classified as reauth.
    expect(result).toMatchObject({
      due: 3,
      reconciled: 1,
      changed: 2,
      failures: 1,
      reauth: 1,
    });
  });
});

describe("cleanupMirrors", () => {
  it("trims each connected account within the default window", async () => {
    const { service, removeCalls } = build({
      connectedUserIds: ["a", "b"],
      removeMirrorOutsideWindow: async (userId) => (userId === "a" ? 3 : 1),
    });

    const result = await service.cleanupMirrors();

    expect(result).toEqual({ accounts: 2, removed: 4, failures: 0 });
    const window = mirrorWindow(NOW.toISOString());
    expect(removeCalls[0]).toEqual({
      userId: "a",
      timeMin: new Date(window.timeMin),
      timeMax: new Date(window.timeMax),
    });
  });

  it("isolates one account's cleanup failure", async () => {
    const { service } = build({
      connectedUserIds: ["a", "b"],
      removeMirrorOutsideWindow: async (userId) => {
        if (userId === "a") {
          throw new Error("db error");
        }
        return 2;
      },
    });

    expect(await service.cleanupMirrors()).toEqual({
      accounts: 2,
      removed: 2,
      failures: 1,
    });
  });
});

describe("purgeResolvedJobs", () => {
  it("purges both outboxes at the retention cutoff", async () => {
    const { service, purgeCalls } = build({ purgeSync: 5, purgeExport: 2 });

    const result = await service.purgeResolvedJobs();

    expect(result).toEqual({ syncJobs: 5, exportJobs: 2 });
    // Both purge at the same retention cutoff derived from the injected clock.
    expect(purgeCalls.sync).toEqual(purgeCalls.export);
    expect(purgeCalls.sync).not.toBeNull();
  });
});

describe("expandForAccount", () => {
  it("rejects an invalid request body before touching the connection", async () => {
    const { service, expandWindow } = build({ hasConnection: true });

    const result = await service.expandForAccount("u1", { through: "nope" });

    expect(result).toMatchObject({ ok: false, reason: "invalid_shape" });
    expect(expandWindow).not.toHaveBeenCalled();
  });

  it("reports not_connected when the account has no connection", async () => {
    const { service, expandWindow } = build({ hasConnection: false });

    expect(
      await service.expandForAccount("u1", { through: NOW.toISOString() }),
    ).toEqual({
      ok: false,
      reason: "not_connected",
    });
    expect(expandWindow).not.toHaveBeenCalled();
  });

  it("expands every visible calendar and aggregates the counts", async () => {
    const { service, expandWindow } = build({
      hasConnection: true,
      visibleCalendars: [
        { googleCalendarId: "c1" },
        { googleCalendarId: "c2" },
      ],
      expandWindow: async (_userId, calendarId) =>
        calendarId === "c1"
          ? { ok: true, changed: 4, removed: 1 }
          : { ok: false, reason: "unauthorized" },
    });

    const result = await service.expandForAccount("u1", {
      through: NOW.toISOString(),
    });

    expect(result).toEqual({
      ok: true,
      calendars: 1,
      changed: 4,
      removed: 1,
      failures: 1,
    });
    expect(expandWindow).toHaveBeenCalledTimes(2);
  });
});

describe("reconcile — cutoff", () => {
  it("asks the repository for calendars due before the staleness cutoff", async () => {
    const listDue = vi.fn(async () => []);
    const service = createCalendarMaintenanceService({
      calendarRepository: {
        listCalendarsDueForReconciliation: listDue,
      } as unknown as CalendarRepository,
      eventRepository: {} as EventRepository,
      syncJobRepository: {} as CalendarSyncJobRepository,
      exportJobRepository: {} as EventExportJobRepository,
      watchService: {} as CalendarWatchService,
      incrementalSyncService: {} as IncrementalSyncService,
      now: () => NOW,
    });

    await service.reconcile();

    expect(listDue).toHaveBeenCalledWith(reconciliationCutoff(NOW));
  });
});
