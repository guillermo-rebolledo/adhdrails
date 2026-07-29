import { z } from "zod";

import { mirrorWindow } from "@/domain/calendar/import";
import {
  expandRangeRequestSchema,
  maintenanceJobRetentionCutoff,
  reconciliationCutoff,
} from "@/domain/calendar/maintenance";
import type { EventRepository } from "@/server/event/repository";
import type { EventExportJobRepository } from "@/server/event/export-job-repository";

import type { IncrementalSyncService } from "./incremental-sync-service";
import type { CalendarRepository } from "./repository";
import type { CalendarSyncJobRepository } from "./sync-job-repository";
import type { CalendarWatchService } from "./watch-service";

export interface CalendarMaintenanceDependencies {
  calendarRepository: CalendarRepository;
  eventRepository: EventRepository;
  syncJobRepository: CalendarSyncJobRepository;
  exportJobRepository: EventExportJobRepository;
  watchService: CalendarWatchService;
  incrementalSyncService: IncrementalSyncService;
  /** Injectable clock so every maintenance decision is deterministic. */
  now?: () => Date;
}

/** What one watch-renewal sweep did across every connected account. */
export interface RenewWatchesResult {
  accounts: number;
  registered: number;
  skipped: number;
  /** Accounts whose renewal could not complete (a Google error, non-terminal). */
  failures: number;
  /** Accounts whose grant is no longer valid — a terminal, needs-reconnect state. */
  reauth: number;
}

/** What one reconciliation sweep did across every due calendar. */
export interface ReconcileResult {
  due: number;
  reconciled: number;
  changed: number;
  removed: number;
  /** Calendars whose reconciliation triggered a bounded full resync after a 410. */
  recovered: number;
  /** Calendars whose reconciliation could not complete (non-terminal failure). */
  failures: number;
  /** Calendars whose account grant is no longer valid — a terminal, needs-reconnect state. */
  reauth: number;
}

/** What one mirror-cleanup sweep trimmed across every connected account. */
export interface CleanupMirrorsResult {
  accounts: number;
  removed: number;
  failures: number;
}

/** What one retention purge reclaimed from the maintenance outboxes. */
export interface PurgeResolvedJobsResult {
  syncJobs: number;
  exportJobs: number;
}

/** The outcome of an on-demand expansion request for one account's calendars. */
export type ExpandForAccountResult =
  | {
      ok: true;
      calendars: number;
      changed: number;
      removed: number;
      failures: number;
    }
  | { ok: false; reason: "not_connected" }
  | {
      ok: false;
      reason: "invalid_shape";
      fieldErrors: Record<string, string[]>;
    };

/**
 * Owns the durable maintenance that keeps the Calendar mirror resilient (MEM-43).
 * It is the use-case layer the scheduled Inngest functions call: renew watches
 * before they expire, reconcile calendars that have gone quiet, trim the mirror
 * back to its window, purge resolved outbox records, and — on demand — expand the
 * window when the user browses past the horizon. Every sweep isolates failures
 * per account or per calendar so one bad calendar never aborts the rest, and it
 * composes the existing watch and incremental-sync services rather than
 * re-implementing their idempotent bodies. It depends only on injected
 * repositories and services, never on Inngest or HTTP.
 */
export function createCalendarMaintenanceService(
  deps: CalendarMaintenanceDependencies,
) {
  const {
    calendarRepository,
    eventRepository,
    syncJobRepository,
    exportJobRepository,
    watchService,
    incrementalSyncService,
    now = () => new Date(),
  } = deps;

  return {
    /**
     * Renews every connected account's push watches that are close to expiry, so
     * Google keeps delivering change notifications. The watch service already
     * skips watches that are comfortably fresh, so this is cheap and idempotent to
     * re-run. A single account whose renewal fails (needs re-auth, or a Google
     * error) is counted and skipped; the sweep continues to the next account.
     */
    async renewWatches(): Promise<RenewWatchesResult> {
      const userIds = await calendarRepository.listConnectedUserIds();
      let registered = 0;
      let skipped = 0;
      let failures = 0;
      let reauth = 0;

      for (const userId of userIds) {
        try {
          const result = await watchService.ensureWatches(userId);
          if (result.ok) {
            registered += result.registered;
            skipped += result.skipped;
          } else if (result.reason === "unauthorized") {
            // Terminal: the grant is gone. Distinguished from a transient error so
            // a needs-reconnect account is visible rather than a generic failure.
            reauth += 1;
          } else {
            failures += 1;
          }
        } catch {
          // A Google watch/refresh error for one account must not abort the sweep.
          failures += 1;
        }
      }

      return {
        accounts: userIds.length,
        registered,
        skipped,
        failures,
        reauth,
      };
    },

    /**
     * Resyncs every calendar that has gone quiet — its last successful sync aged
     * past the staleness cutoff, or it never synced — as a backstop for missed
     * webhooks and expired watches. The incremental sync it runs is idempotent
     * (it upserts by provider identity and resumes from the stored cursor), so
     * reconciliation never duplicates already-synchronized Events. A `410 Gone`
     * is handled inside the sync as a bounded full resync and counted as a
     * recovery. One calendar's failure is isolated: it is counted and skipped, and
     * the remaining due calendars still reconcile.
     */
    async reconcile(): Promise<ReconcileResult> {
      const due = await calendarRepository.listCalendarsDueForReconciliation(
        reconciliationCutoff(now()),
      );
      let reconciled = 0;
      let changed = 0;
      let removed = 0;
      let recovered = 0;
      let failures = 0;
      let reauth = 0;

      for (const calendar of due) {
        try {
          const result = await incrementalSyncService.syncCalendar(
            calendar.userId,
            calendar.googleCalendarId,
          );
          if (result.ok) {
            reconciled += 1;
            changed += result.changed;
            removed += result.removed;
            if (result.recovered) {
              recovered += 1;
            }
          } else if (result.reason === "unauthorized") {
            // Terminal: the account's grant is gone. Distinguished from a
            // transient failure so a needs-reconnect account is visible.
            reauth += 1;
          } else {
            failures += 1;
          }
        } catch {
          // A transient error on one calendar must not abort the whole sweep.
          failures += 1;
        }
      }

      return {
        due: due.length,
        reconciled,
        changed,
        removed,
        recovered,
        failures,
        reauth,
      };
    },

    /**
     * Trims every connected account's mirror back to the default window, so it
     * does not grow without bound as time passes. Only Google-origin rows outside
     * the window are removed; local app-owned Events and all current agenda data
     * inside the window are preserved. One account's failure is isolated.
     *
     * This is the steady state the mirror always returns to. Rows an on-demand
     * {@link expandForAccount} wrote past the default horizon are deliberately
     * reclaimed here — expansion is ephemeral coverage the client re-requests when
     * it browses that far again, never a permanent widening of the window.
     */
    async cleanupMirrors(): Promise<CleanupMirrorsResult> {
      const window = mirrorWindow(now().toISOString());
      const timeMin = new Date(window.timeMin);
      const timeMax = new Date(window.timeMax);
      const userIds = await calendarRepository.listConnectedUserIds();
      let removed = 0;
      let failures = 0;

      for (const userId of userIds) {
        try {
          removed += await eventRepository.removeMirrorOutsideWindow(
            userId,
            timeMin,
            timeMax,
          );
        } catch {
          failures += 1;
        }
      }

      return { accounts: userIds.length, removed, failures };
    },

    /**
     * Purges resolved sync and export outbox rows older than the retention
     * window, so operational visibility never becomes unbounded growth. Pending
     * and in-flight work is never touched.
     */
    async purgeResolvedJobs(): Promise<PurgeResolvedJobsResult> {
      const cutoff = maintenanceJobRetentionCutoff(now());
      const syncJobs = await syncJobRepository.purgeResolvedBefore(cutoff);
      const exportJobs = await exportJobRepository.purgeResolvedBefore(cutoff);
      return { syncJobs, exportJobs };
    },

    /**
     * On-demand range expansion (MEM-43): brings every visible calendar current
     * over the default window stretched forward to the requested instant, for when
     * the user browses past the default horizon. Additive only — expansion upserts
     * by provider identity and never advances a cursor — so current agenda data is
     * preserved. A per-calendar failure is isolated and counted.
     *
     * The coverage it writes past the default horizon is ephemeral: the daily
     * {@link cleanupMirrors} sweep reclaims it, so the client re-requests expansion
     * whenever it browses that far again. The request is validated here against a
     * feature-owned Zod schema so the route only translates the outcome.
     */
    async expandForAccount(
      userId: string,
      rawInput: unknown,
    ): Promise<ExpandForAccountResult> {
      const parsed = expandRangeRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid_shape",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }
      const throughIso = new Date(parsed.data.through).toISOString();

      const connection = await calendarRepository.getConnection(userId);
      if (!connection) {
        return { ok: false, reason: "not_connected" };
      }

      const calendars =
        await calendarRepository.listVisibleCalendarSyncState(userId);
      let expanded = 0;
      let changed = 0;
      let removed = 0;
      let failures = 0;

      for (const calendar of calendars) {
        const result = await incrementalSyncService.expandWindow(
          userId,
          calendar.googleCalendarId,
          throughIso,
        );
        if (result.ok) {
          expanded += 1;
          changed += result.changed;
          removed += result.removed;
        } else {
          failures += 1;
        }
      }

      return { ok: true, calendars: expanded, changed, removed, failures };
    },
  };
}

export type CalendarMaintenanceService = ReturnType<
  typeof createCalendarMaintenanceService
>;
