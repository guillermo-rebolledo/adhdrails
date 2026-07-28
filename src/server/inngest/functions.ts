import {
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
import { logOperationalEvent } from "@/server/observability/logger";

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

/** All Inngest functions Rails serves. */
export const inngestFunctions = [
  calendarIncrementalSync,
  calendarSyncOutboxDrain,
  calendarEventExport,
  calendarExportOutboxDrain,
];
