import type { EventSender } from "@/server/calendar/sync-dispatcher";

import type { AccountDeletionRepository } from "./deletion-repository";

export const ACCOUNT_DELETION_EVENT = "account/deletion.requested";

export interface AccountDeletionDispatcher {
  dispatch(input: { jobId: string }): Promise<void>;
}

export function createAccountDeletionDispatcher(
  sender: EventSender,
): AccountDeletionDispatcher {
  return {
    async dispatch({ jobId }) {
      await sender.send({
        name: ACCOUNT_DELETION_EVENT,
        data: { jobId },
      });
    },
  };
}

export interface RecordingAccountDeletionDispatcher extends AccountDeletionDispatcher {
  readonly dispatched: string[];
}

export function createRecordingAccountDeletionDispatcher(
  options: { failWith?: Error } = {},
): RecordingAccountDeletionDispatcher {
  const dispatched: string[] = [];
  return {
    dispatched,
    async dispatch({ jobId }) {
      if (options.failWith) {
        throw options.failWith;
      }
      dispatched.push(jobId);
    },
  };
}

export async function drainPendingAccountDeletions(deps: {
  repository: AccountDeletionRepository;
  dispatcher: AccountDeletionDispatcher;
  limit?: number;
}): Promise<number> {
  const jobs = await deps.repository.listDispatchable(deps.limit ?? 100);
  let dispatched = 0;
  for (const job of jobs) {
    await deps.dispatcher.dispatch({ jobId: job.id });
    dispatched += 1;
  }
  return dispatched;
}
