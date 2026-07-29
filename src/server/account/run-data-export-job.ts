import {
  DATA_EXPORT_TTL_MS,
  buildDataExportDocument,
} from "@/domain/account/data-export";

import type { DataExportRepository } from "./data-export-repository";

export interface RunDataExportJobDependencies {
  repository: DataExportRepository;
  /** Injectable clock so the export time and TTL are deterministic in tests. */
  now?: () => Date;
}

export type RunDataExportJobResult =
  | { status: "completed"; byteSize: number }
  | { status: "skipped"; reason: "unknown_job" | "already_finished" }
  | { status: "failed"; reason: string };

/**
 * Runs one data-export job to completion: the durable, idempotent body the
 * Inngest exporter executes (MEM-48). It is safe to run more than once — a
 * finished job short-circuits — so an Inngest retry after a transient failure
 * never double-produces. It reads the account's app-owned data, assembles the
 * redacted archive (the domain builder drops mirrored Google Events and never
 * sees any secret), stores it with a bounded download window, and marks the job
 * completed. A missing account marks the job `failed` with a safe code; a
 * genuine transient exception is left to propagate so the durable runner retries.
 */
export async function runDataExportJob(
  deps: RunDataExportJobDependencies,
  jobId: string,
): Promise<RunDataExportJobResult> {
  const { repository, now = () => new Date() } = deps;

  const job = await repository.getById(jobId);
  if (!job) {
    return { status: "skipped", reason: "unknown_job" };
  }
  if (job.status !== "pending" && job.status !== "processing") {
    return { status: "skipped", reason: "already_finished" };
  }

  await repository.markProcessing(jobId);

  const source = await repository.collectAccountData(job.userId);
  if (!source) {
    await repository.markFailed(jobId, "account_missing");
    return { status: "failed", reason: "account_missing" };
  }

  const at = now();
  const document = buildDataExportDocument(source, at.toISOString());
  const payload = JSON.stringify(document, null, 2);
  const byteSize = Buffer.byteLength(payload, "utf8");

  await repository.markCompleted(jobId, {
    payload,
    byteSize,
    expiresAt: new Date(at.getTime() + DATA_EXPORT_TTL_MS),
  });

  return { status: "completed", byteSize };
}
