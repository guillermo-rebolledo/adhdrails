import {
  getIncrementalSyncService,
  getCalendarSyncJobRepository,
} from "@/server/calendar/service-factory";
import { runIncrementalSyncJob } from "@/server/calendar/run-sync-job";
import { INCREMENTAL_SYNC_EVENT } from "@/server/calendar/sync-dispatcher";
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

/** All Inngest functions Rails serves. */
export const inngestFunctions = [calendarIncrementalSync];
