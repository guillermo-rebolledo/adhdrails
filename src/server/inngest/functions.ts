import {
  getCalendarMaintenanceService,
  getCalendarSyncDispatcher,
  getEventExportDispatcher,
  getEventExportJobRepository,
  getEventExportService,
  getIncrementalSyncService,
  getCalendarSyncJobRepository,
} from "@/server/calendar/service-factory";
import {
  EVENT_EXPORT_EVENT,
  drainPendingExportJobs,
} from "@/server/calendar/export-dispatcher";
import { runEventExportJob } from "@/server/calendar/run-export-job";
import { runIncrementalSyncJob } from "@/server/calendar/run-sync-job";
import {
  INCREMENTAL_SYNC_EVENT,
  drainPendingSyncJobs,
} from "@/server/calendar/sync-dispatcher";
import {
  DATA_EXPORT_EVENT,
  drainPendingDataExports,
} from "@/server/account/data-export-dispatcher";
import { runDataExportJob } from "@/server/account/run-data-export-job";
import {
  getDataExportDispatcher,
  getDataExportRepository,
  getAccountDeletionDispatcher,
  getAccountDeletionRepository,
} from "@/server/account/service-factory";
import {
  ACCOUNT_DELETION_EVENT,
  drainPendingAccountDeletions,
} from "@/server/account/deletion-dispatcher";
import { runAccountDeletionJob } from "@/server/account/run-account-deletion-job";
import {
  getCalendarService,
  revokeGoogleProviderToken,
} from "@/server/calendar/service-factory";
import { logOperationalEvent } from "@/server/observability/logger";
import { getReminderDeliveryService } from "@/server/notification/service-factory";

import { inngest } from "./client";

/**
 * The durable incremental-sync function (MEM-41). A verified webhook enqueues one
 * event per delivered notification; this function reloads the outbox job by id
 * and runs it to completion. Inngest owns retry and run history, so on a
 * transient failure the whole function re-runs — safe because the job body is
 * idempotent (an already-completed job short-circuits and the mirror upserts by
 * provider identity). Only a safe metadata line is logged; provider payloads and
 * user content never reach the log.
 */
export const calendarIncrementalSync = inngest.createFunction(
  {
    id: "calendar-incremental-sync",
    retries: 3,
    triggers: [{ event: INCREMENTAL_SYNC_EVENT }],
  },
  async ({ event }) => {
    const jobId = String((event.data as { jobId?: unknown }).jobId ?? "");

    const result = await runIncrementalSyncJob(
      {
        syncJobRepository: getCalendarSyncJobRepository(),
        incrementalSyncService: getIncrementalSyncService(),
      },
      jobId,
    );

    logOperationalEvent({
      correlationId: jobId,
      action: "calendar.incremental_synced",
      outcome: result.status === "failed" ? "failure" : "success",
      safeCode: result.status === "failed" ? result.reason : undefined,
    });

    return result;
  },
);

/**
 * The scheduled outbox drain (MEM-41). A verified webhook dispatches inline for
 * immediacy, but a dispatch that fails after the outbox row is committed would
 * otherwise leave a durable `pending` job with nothing to deliver it. This
 * periodic sweep redelivers any such rows to the incremental-sync function, so
 * the transactional outbox's durability guarantee actually holds. Redelivery is
 * safe: the sync body is idempotent and an already-completed job short-circuits.
 */
export const calendarSyncOutboxDrain = inngest.createFunction(
  { id: "calendar-sync-outbox-drain", triggers: [{ cron: "*/5 * * * *" }] },
  async () => {
    const dispatched = await drainPendingSyncJobs({
      syncJobRepository: getCalendarSyncJobRepository(),
      dispatcher: getCalendarSyncDispatcher(),
    });

    logOperationalEvent({
      correlationId: crypto.randomUUID(),
      action: "calendar.outbox_drained",
      outcome: "success",
    });

    return { dispatched };
  },
);

/**
 * The durable Event exporter (MEM-42): the outbound counterpart to
 * {@link calendarIncrementalSync}. The scheduled drain enqueues one event per
 * pending export job; this function reloads the outbox job by id and runs it to
 * completion. Inngest owns retry and run history, so a transient Google failure
 * re-runs the whole function — safe because the body is idempotent (a finished
 * job short-circuits and a re-export patches the existing Google Event rather
 * than creating a duplicate). Only safe metadata is logged as the operational
 * audit record; titles and provider payloads never reach the log.
 */
export const calendarEventExport = inngest.createFunction(
  {
    id: "calendar-event-export",
    retries: 3,
    triggers: [{ event: EVENT_EXPORT_EVENT }],
  },
  async ({ event }) => {
    const jobId = String((event.data as { jobId?: unknown }).jobId ?? "");

    const result = await runEventExportJob(
      {
        exportJobRepository: getEventExportJobRepository(),
        exportService: getEventExportService(),
      },
      jobId,
    );

    logOperationalEvent({
      correlationId: jobId,
      action: "calendar.event_exported",
      outcome: result.status === "failed" ? "failure" : "success",
      safeCode:
        result.status === "completed"
          ? result.outcome
          : result.status === "skipped" || result.status === "failed"
            ? result.reason
            : undefined,
    });

    return result;
  },
);

/**
 * The scheduled export drain (MEM-42). Mutations never dispatch inline; they only
 * record a durable pending export job in their own transaction. This periodic
 * sweep delivers those rows to the exporter, so the transactional outbox's
 * durability guarantee holds and no local change fails to reach Google. Redelivery
 * is safe: the export body is idempotent and a finished job short-circuits.
 */
export const calendarExportOutboxDrain = inngest.createFunction(
  { id: "calendar-export-outbox-drain", triggers: [{ cron: "*/5 * * * *" }] },
  async () => {
    const dispatched = await drainPendingExportJobs({
      exportJobRepository: getEventExportJobRepository(),
      dispatcher: getEventExportDispatcher(),
    });

    logOperationalEvent({
      correlationId: crypto.randomUUID(),
      action: "calendar.export_outbox_drained",
      outcome: "success",
    });

    return { dispatched };
  },
);

/**
 * Scheduled watch renewal (MEM-43). Google stops delivering change notifications
 * once a push channel expires, so this sweep renews every connected account's
 * watches before they lapse. Renewal is idempotent — a comfortably fresh watch is
 * left alone — so re-running is cheap, and one account's failure is isolated from
 * the rest. `concurrency` caps it to one run at a time so overlapping schedules
 * never stack; `retries` lets a transient failure re-run the whole idempotent
 * sweep. Only safe metadata is logged.
 */
export const calendarWatchRenewal = inngest.createFunction(
  {
    id: "calendar-watch-renewal",
    retries: 3,
    concurrency: { limit: 1 },
    triggers: [{ cron: "0 */6 * * *" }],
  },
  async () => {
    const result = await getCalendarMaintenanceService().renewWatches();

    logOperationalEvent({
      correlationId: crypto.randomUUID(),
      action: "calendar.watch_renewal",
      outcome: result.failures + result.reauth > 0 ? "failure" : "success",
      safeCode:
        result.reauth > 0
          ? "needs_reauth"
          : result.failures > 0
            ? "partial_failure"
            : undefined,
    });

    return result;
  },
);

/**
 * Scheduled reconciliation (MEM-43). A missed webhook or an expired watch leaves a
 * calendar silently stale; this sweep resyncs every calendar that has gone quiet
 * past the staleness cutoff. The incremental sync it runs is idempotent (upsert by
 * provider identity, resume from the stored cursor), so reconciliation detects
 * missed changes without duplicating synchronized Events, and a `410 Gone`
 * recovers as a bounded full resync. One calendar's failure is isolated. Only safe
 * metadata is logged.
 */
export const calendarReconciliation = inngest.createFunction(
  {
    id: "calendar-reconciliation",
    retries: 3,
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/30 * * * *" }],
  },
  async () => {
    const result = await getCalendarMaintenanceService().reconcile();

    logOperationalEvent({
      correlationId: crypto.randomUUID(),
      action: "calendar.reconciled",
      outcome: result.failures + result.reauth > 0 ? "failure" : "success",
      safeCode:
        result.reauth > 0
          ? "needs_reauth"
          : result.failures > 0
            ? "partial_failure"
            : undefined,
    });

    return result;
  },
);

/**
 * Scheduled mirror cleanup and retention purge (MEM-43). The mirror would grow
 * without bound as time passes, and resolved outbox rows would accumulate
 * indefinitely; this daily sweep trims every account's mirror back to the default
 * window — preserving local Events and all current agenda data — and purges
 * resolved sync/export records older than the retention window. Idempotent and
 * safe to re-run; only safe metadata is logged.
 */
export const calendarMirrorCleanup = inngest.createFunction(
  {
    id: "calendar-mirror-cleanup",
    retries: 3,
    concurrency: { limit: 1 },
    triggers: [{ cron: "0 3 * * *" }],
  },
  async () => {
    const service = getCalendarMaintenanceService();
    const mirrors = await service.cleanupMirrors();
    const purged = await service.purgeResolvedJobs();

    logOperationalEvent({
      correlationId: crypto.randomUUID(),
      action: "calendar.mirror_cleaned",
      outcome: mirrors.failures > 0 ? "failure" : "success",
      safeCode: mirrors.failures > 0 ? "partial_failure" : undefined,
    });

    return { mirrors, purged };
  },
);

/**
 * Near-term reminder sweep. Long-range schedules remain canonical on Tasks;
 * each minute this function resolves wall-clock intent in the account timezone,
 * atomically claims each per-device delivery, and retries only safe provider
 * failures. Event notifications are intentionally absent—Google owns them.
 */
export const timedTaskReminders = inngest.createFunction(
  {
    id: "timed-task-reminders",
    retries: 3,
    concurrency: { limit: 1 },
    triggers: [{ cron: "* * * * *" }],
  },
  async () => {
    const result = await getReminderDeliveryService().run(new Date());

    logOperationalEvent({
      correlationId: crypto.randomUUID(),
      action: "task.reminders_delivered",
      outcome: result.failed > 0 ? "failure" : "success",
      safeCode: result.failed > 0 ? "push_unavailable" : undefined,
    });

    return result;
  },
);

/**
 * The durable data exporter (MEM-48). A request records a `pending` row and
 * dispatches this function; it reloads the job by id and assembles the account's
 * app-owned archive to completion. Inngest owns retry and run history, so a
 * transient failure re-runs the whole idempotent body — a finished job
 * short-circuits, so a retry never double-produces. Only safe metadata is logged
 * as the operational audit record; exported content and titles never reach the log.
 */
export const accountDataExport = inngest.createFunction(
  {
    id: "account-data-export",
    retries: 3,
    triggers: [{ event: DATA_EXPORT_EVENT }],
  },
  async ({ event }) => {
    const jobId = String((event.data as { jobId?: unknown }).jobId ?? "");

    const result = await runDataExportJob(
      { repository: getDataExportRepository() },
      jobId,
    );

    logOperationalEvent({
      correlationId: jobId,
      action: "account.data_exported",
      outcome: result.status === "failed" ? "failure" : "success",
      safeCode:
        result.status === "failed" || result.status === "skipped"
          ? result.reason
          : undefined,
    });

    return result;
  },
);

/**
 * The scheduled data-export drain (MEM-48). The request path dispatches inline
 * for immediacy, but a dispatch that fails after the pending row is committed
 * would otherwise leave a durable job with nothing to run it. This periodic
 * sweep redelivers any such rows to the exporter, so the transactional outbox's
 * durability guarantee holds. Redelivery is safe: the export body is idempotent
 * and a finished job short-circuits.
 */
export const accountDataExportOutboxDrain = inngest.createFunction(
  {
    id: "account-data-export-outbox-drain",
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async () => {
    const dispatched = await drainPendingDataExports({
      repository: getDataExportRepository(),
      dispatcher: getDataExportDispatcher(),
    });

    logOperationalEvent({
      correlationId: crypto.randomUUID(),
      action: "account.data_export_outbox_drained",
      outcome: "success",
    });

    return { dispatched };
  },
);

/**
 * Scheduled data-export expiry (MEM-48). A completed archive is downloadable for
 * a bounded window; this daily sweep marks every archive past its window
 * `expired` and clears its stored payload, so a user's exported data is never
 * retained on the server indefinitely. Idempotent and safe to re-run; only safe
 * metadata is logged.
 */
export const accountDataExportCleanup = inngest.createFunction(
  {
    id: "account-data-export-cleanup",
    retries: 3,
    concurrency: { limit: 1 },
    triggers: [{ cron: "0 4 * * *" }],
  },
  async () => {
    const expired = await getDataExportRepository().expireCompleted(new Date());

    logOperationalEvent({
      correlationId: crypto.randomUUID(),
      action: "account.data_exports_expired",
      outcome: "success",
    });

    return { expired };
  },
);

/** Durable account cleanup. Access was already disabled by the request path. */
export const accountDeletionCleanup = inngest.createFunction(
  {
    id: "account-deletion-cleanup",
    retries: 5,
    triggers: [{ event: ACCOUNT_DELETION_EVENT }],
  },
  async ({ event }) => {
    const jobId = String((event.data as { jobId?: unknown }).jobId ?? "");
    const result = await runAccountDeletionJob(
      {
        repository: getAccountDeletionRepository(),
        disconnectCalendar: (userId) =>
          getCalendarService().disconnectForAccountDeletion(userId),
        revokeProviderToken: revokeGoogleProviderToken,
      },
      jobId,
    );

    logOperationalEvent({
      correlationId: jobId,
      action: "account.deleted",
      outcome: result.status === "completed" ? "success" : "failure",
      safeCode: result.status === "skipped" ? result.reason : undefined,
    });
    return result;
  },
);

/** Backstop for a request whose inline Inngest dispatch did not arrive. */
export const accountDeletionOutboxDrain = inngest.createFunction(
  {
    id: "account-deletion-outbox-drain",
    retries: 3,
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async () => {
    const dispatched = await drainPendingAccountDeletions({
      repository: getAccountDeletionRepository(),
      dispatcher: getAccountDeletionDispatcher(),
    });
    return { dispatched };
  },
);

/** Purges completed deletion receipts at 30 days and audit metadata at 90. */
export const accountDataLifecycleCleanup = inngest.createFunction(
  {
    id: "account-data-lifecycle-cleanup",
    retries: 3,
    concurrency: { limit: 1 },
    triggers: [{ cron: "0 5 * * *" }],
  },
  async () => {
    const purged = await getAccountDeletionRepository().purgeExpired(
      new Date(),
    );
    logOperationalEvent({
      correlationId: crypto.randomUUID(),
      action: "account.lifecycle_purged",
      outcome: "success",
    });
    return purged;
  },
);

/** All Inngest functions Rails serves. */
export const inngestFunctions = [
  calendarIncrementalSync,
  calendarSyncOutboxDrain,
  calendarEventExport,
  calendarExportOutboxDrain,
  calendarWatchRenewal,
  calendarReconciliation,
  calendarMirrorCleanup,
  timedTaskReminders,
  accountDataExport,
  accountDataExportOutboxDrain,
  accountDataExportCleanup,
  accountDeletionCleanup,
  accountDeletionOutboxDrain,
  accountDataLifecycleCleanup,
];
