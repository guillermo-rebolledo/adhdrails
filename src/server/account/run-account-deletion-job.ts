import type { AccountDeletionRepository } from "./deletion-repository";

export interface RunAccountDeletionJobDependencies {
  repository: AccountDeletionRepository;
  disconnectCalendar: (userId: string) => Promise<unknown>;
  revokeProviderToken: (token: string) => Promise<unknown>;
  now?: () => Date;
}

export type RunAccountDeletionJobResult =
  | { status: "completed" }
  | {
      status: "skipped";
      reason:
        | "unknown_job"
        | "already_finished"
        | "account_missing"
        | "already_processing";
    };

/**
 * Durable, idempotent deletion body. Provider cleanup happens before the local
 * cascade; if any step throws, the account remains disabled and the same job can
 * safely retry without restoring a session or creating a second tombstone.
 */
export async function runAccountDeletionJob(
  deps: RunAccountDeletionJobDependencies,
  jobId: string,
): Promise<RunAccountDeletionJobResult> {
  const { repository, now = () => new Date() } = deps;
  const job = await repository.getById(jobId);
  if (!job) {
    return { status: "skipped", reason: "unknown_job" };
  }
  if (job.status === "completed") {
    return { status: "skipped", reason: "already_finished" };
  }
  if (!job.userId) {
    return { status: "skipped", reason: "account_missing" };
  }

  const at = now();
  const claimed = await repository.markProcessing(jobId, at);
  if (!claimed) {
    return { status: "skipped", reason: "already_processing" };
  }

  try {
    const identityTokens = await repository.listIdentityProviderTokens(
      job.userId,
    );
    await deps.disconnectCalendar(job.userId);
    for (const token of identityTokens) {
      await deps.revokeProviderToken(token);
    }
    await repository.markCompleted(jobId, jobId, at);
    return { status: "completed" };
  } catch (error) {
    await repository.markFailed(jobId, "cleanup_failed", jobId, at);
    throw error;
  }
}
