import type { IncrementalSyncService } from "./incremental-sync-service";
import type { CalendarSyncJobRepository } from "./sync-job-repository";

export interface RunSyncJobDependencies {
  syncJobRepository: CalendarSyncJobRepository;
  incrementalSyncService: IncrementalSyncService;
}

export type RunSyncJobResult =
  | {
      status: "completed";
      changed: number;
      removed: number;
      recovered: boolean;
    }
  | { status: "skipped"; reason: "unknown_job" | "already_completed" }
  | { status: "failed"; reason: string };

/**
 * Runs one outbox job to completion: the durable, idempotent body the Inngest
 * incremental-sync function executes (MEM-41). It is safe to run more than once —
 * an already-completed job short-circuits, and the sync itself upserts by
 * provider identity — so an Inngest retry after a transient failure never
 * duplicates work. Terminal outcomes (not connected, needs re-auth, calendar
 * gone) mark the job failed with a safe code; a genuine exception is left to
 * propagate so the durable runner can retry it.
 */
export async function runIncrementalSyncJob(
  deps: RunSyncJobDependencies,
  jobId: string,
): Promise<RunSyncJobResult> {
  const { syncJobRepository, incrementalSyncService } = deps;

  const job = await syncJobRepository.getById(jobId);
  if (!job) {
    return { status: "skipped", reason: "unknown_job" };
  }
  if (job.status === "completed") {
    return { status: "skipped", reason: "already_completed" };
  }

  await syncJobRepository.markProcessing(jobId);

  const result = await incrementalSyncService.syncCalendar(
    job.userId,
    job.googleCalendarId,
  );

  if (result.ok) {
    await syncJobRepository.markCompleted(jobId);
    return {
      status: "completed",
      changed: result.changed,
      removed: result.removed,
      recovered: result.recovered,
    };
  }

  // Terminal, non-retryable reasons: record a safe code for failure visibility.
  await syncJobRepository.markFailed(jobId, result.reason);
  return { status: "failed", reason: result.reason };
}
