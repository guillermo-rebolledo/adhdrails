import type { CalendarSyncJobRepository } from "./sync-job-repository";

/** The event name the incremental-sync Inngest function listens for. */
export const INCREMENTAL_SYNC_EVENT = "calendar/incremental-sync.requested";

/** What a dispatched job carries; the Inngest function reloads the rest by id. */
export interface DispatchedSyncJob {
  jobId: string;
}

/**
 * Hands an outbox job to the durable job runner. Abstracted behind an interface
 * so the webhook and reconciliation drain are tested against a recording fake and
 * only production wires the real Inngest client — mirroring the Google adapter
 * boundary.
 */
export interface SyncJobDispatcher {
  dispatch(job: DispatchedSyncJob): Promise<void>;
}

/** The minimal slice of an Inngest client this module needs, for testability. */
export interface EventSender {
  send(event: {
    name: string;
    data: Record<string, unknown>;
  }): Promise<unknown>;
}

/** The production dispatcher: enqueues an Inngest event carrying the job id. */
export function createEventSyncDispatcher(
  sender: EventSender,
): SyncJobDispatcher {
  return {
    async dispatch(job) {
      await sender.send({
        name: INCREMENTAL_SYNC_EVENT,
        data: { jobId: job.jobId },
      });
    },
  };
}

/** A dispatcher that records what it was asked to dispatch, for tests. */
export interface RecordingSyncDispatcher extends SyncJobDispatcher {
  readonly dispatched: string[];
}

export function createRecordingSyncDispatcher(
  options: {
    failWith?: Error;
  } = {},
): RecordingSyncDispatcher {
  const dispatched: string[] = [];
  return {
    dispatched,
    async dispatch(job) {
      if (options.failWith) {
        throw options.failWith;
      }
      dispatched.push(job.jobId);
    },
  };
}

/**
 * The reconciliation backstop: drains pending outbox jobs to the dispatcher,
 * oldest first. A verified webhook dispatches inline for immediacy, but a failed
 * inline dispatch leaves a durable pending row this drain later delivers — so no
 * change is lost if the dispatch call fails after the row is committed. Returns
 * how many jobs were dispatched.
 */
export async function drainPendingSyncJobs(deps: {
  syncJobRepository: CalendarSyncJobRepository;
  dispatcher: SyncJobDispatcher;
  limit?: number;
}): Promise<number> {
  const { syncJobRepository, dispatcher, limit = 100 } = deps;
  const pending = await syncJobRepository.listPending(limit);
  let dispatched = 0;
  for (const job of pending) {
    await dispatcher.dispatch({ jobId: job.id });
    dispatched += 1;
  }
  return dispatched;
}
