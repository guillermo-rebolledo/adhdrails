import type { EventExportJobRepository } from "@/server/event/export-job-repository";

import type { EventSender } from "./sync-dispatcher";

/** The event name the Event-export Inngest function listens for. */
export const EVENT_EXPORT_EVENT = "calendar/event-export.requested";

/** What a dispatched export job carries; the function reloads the rest by id. */
export interface DispatchedExportJob {
  jobId: string;
}

/**
 * Hands an export outbox job to the durable job runner. Abstracted behind an
 * interface so the drain is tested against a recording fake and only production
 * wires the real Inngest client — mirroring {@link import("./sync-dispatcher")}.
 */
export interface ExportJobDispatcher {
  dispatch(job: DispatchedExportJob): Promise<void>;
}

/** The production dispatcher: enqueues an Inngest event carrying the job id. */
export function createEventExportDispatcher(
  sender: EventSender,
): ExportJobDispatcher {
  return {
    async dispatch(job) {
      await sender.send({
        name: EVENT_EXPORT_EVENT,
        data: { jobId: job.jobId },
      });
    },
  };
}

/** A dispatcher that records what it was asked to dispatch, for tests. */
export interface RecordingExportDispatcher extends ExportJobDispatcher {
  readonly dispatched: string[];
}

export function createRecordingExportDispatcher(
  options: { failWith?: Error } = {},
): RecordingExportDispatcher {
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
 * Drains pending export outbox jobs to the dispatcher, oldest first (MEM-42).
 * A mutation records a durable pending row in its own transaction; this periodic
 * sweep delivers those rows to the Inngest exporter, so no export is lost even
 * though the mutation route never dispatches inline. Returns how many jobs were
 * dispatched. Redelivery is safe: the export body is idempotent and a finished
 * job short-circuits.
 */
export async function drainPendingExportJobs(deps: {
  exportJobRepository: EventExportJobRepository;
  dispatcher: ExportJobDispatcher;
  limit?: number;
}): Promise<number> {
  const { exportJobRepository, dispatcher, limit = 100 } = deps;
  const pending = await exportJobRepository.listPending(limit);
  let dispatched = 0;
  for (const job of pending) {
    await dispatcher.dispatch({ jobId: job.id });
    dispatched += 1;
  }
  return dispatched;
}
