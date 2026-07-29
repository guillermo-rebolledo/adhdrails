import type { EventSender } from "@/server/calendar/sync-dispatcher";

import type { DataExportRepository } from "./data-export-repository";

/** The event name the data-export Inngest function listens for. */
export const DATA_EXPORT_EVENT = "account/data-export.requested";

/** What a dispatched export job carries; the function reloads the rest by id. */
export interface DispatchedDataExport {
  jobId: string;
}

/**
 * Hands a data-export job to the durable job runner. Abstracted behind an
 * interface so the request path and the drain are tested against a recording
 * fake and only production wires the real Inngest client — mirroring the
 * Calendar sync/export dispatchers.
 */
export interface DataExportDispatcher {
  dispatch(job: DispatchedDataExport): Promise<void>;
}

/** The production dispatcher: enqueues an Inngest event carrying the job id. */
export function createDataExportDispatcher(
  sender: EventSender,
): DataExportDispatcher {
  return {
    async dispatch(job) {
      await sender.send({
        name: DATA_EXPORT_EVENT,
        data: { jobId: job.jobId },
      });
    },
  };
}

/** A dispatcher that records what it was asked to dispatch, for tests. */
export interface RecordingDataExportDispatcher extends DataExportDispatcher {
  readonly dispatched: string[];
}

export function createRecordingDataExportDispatcher(
  options: { failWith?: Error } = {},
): RecordingDataExportDispatcher {
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
 * Drains pending export jobs to the dispatcher, oldest first (MEM-48). A request
 * records a durable pending row; the request path dispatches inline for
 * immediacy, and this periodic sweep is the backstop that redelivers any row
 * whose inline dispatch failed after the row was committed. Redelivery is safe:
 * the export body is idempotent and a finished job short-circuits. Returns how
 * many jobs were dispatched.
 */
export async function drainPendingDataExports(deps: {
  repository: DataExportRepository;
  dispatcher: DataExportDispatcher;
  limit?: number;
}): Promise<number> {
  const { repository, dispatcher, limit = 100 } = deps;
  const pending = await repository.listPending(limit);
  let dispatched = 0;
  for (const job of pending) {
    await dispatcher.dispatch({ jobId: job.id });
    dispatched += 1;
  }
  return dispatched;
}
