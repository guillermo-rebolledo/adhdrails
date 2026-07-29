import type { EventExportJobRepository } from "@/server/event/export-job-repository";

import type { EventExportService } from "./event-export-service";

export interface RunExportJobDependencies {
  exportJobRepository: EventExportJobRepository;
  exportService: EventExportService;
}

export type RunExportJobResult =
  | { status: "completed"; outcome: "created" | "patched" | "deleted" }
  | {
      status: "skipped";
      reason: "unknown_job" | "already_finished" | string;
    }
  | { status: "failed"; reason: string };

/**
 * Runs one export job to completion: the durable, idempotent body the Inngest
 * exporter executes (MEM-42). It is safe to run more than once — a finished job
 * short-circuits, and a re-export patches the existing Google Event rather than
 * inserting a second one — so an Inngest retry after a transient failure never
 * duplicates. Terminal no-ops mark the job `skipped` with a safe reason; terminal
 * failures (not connected, needs re-auth) mark it `failed` with a safe code; a
 * genuine transient exception is left to propagate so the durable runner retries.
 */
export async function runEventExportJob(
  deps: RunExportJobDependencies,
  jobId: string,
): Promise<RunExportJobResult> {
  const { exportJobRepository, exportService } = deps;

  const job = await exportJobRepository.getById(jobId);
  if (!job) {
    return { status: "skipped", reason: "unknown_job" };
  }
  if (
    job.status === "completed" ||
    job.status === "skipped" ||
    job.status === "failed"
  ) {
    return { status: "skipped", reason: "already_finished" };
  }

  await exportJobRepository.markProcessing(jobId);

  const result = await exportService.exportEvent(job);

  if (result.ok) {
    if (result.outcome === "skipped") {
      await exportJobRepository.markSkipped(jobId, result.reason);
      return { status: "skipped", reason: result.reason };
    }
    await exportJobRepository.markCompleted(jobId);
    return { status: "completed", outcome: result.outcome };
  }

  await exportJobRepository.markFailed(jobId, result.reason);
  return { status: "failed", reason: result.reason };
}
