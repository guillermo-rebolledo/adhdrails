import { describe, expect, it } from "vitest";

import {
  INCREMENTAL_SYNC_EVENT,
  createEventSyncDispatcher,
  createRecordingSyncDispatcher,
  drainPendingSyncJobs,
} from "./sync-dispatcher";
import type { CalendarSyncJobRepository } from "./sync-job-repository";

describe("createEventSyncDispatcher", () => {
  it("sends the incremental-sync event carrying the job id", async () => {
    const sent: { name: string; data: Record<string, unknown> }[] = [];
    const dispatcher = createEventSyncDispatcher({
      async send(event) {
        sent.push(event);
        return undefined;
      },
    });

    await dispatcher.dispatch({ jobId: "job-1" });

    expect(sent).toEqual([
      { name: INCREMENTAL_SYNC_EVENT, data: { jobId: "job-1" } },
    ]);
  });
});

describe("drainPendingSyncJobs", () => {
  it("dispatches every pending job, oldest first", async () => {
    const pending = [{ id: "job-1" }, { id: "job-2" }, { id: "job-3" }];
    const syncJobRepository = {
      async listPending() {
        return pending;
      },
    } as unknown as CalendarSyncJobRepository;
    const dispatcher = createRecordingSyncDispatcher();

    const count = await drainPendingSyncJobs({ syncJobRepository, dispatcher });

    expect(count).toBe(3);
    expect(dispatcher.dispatched).toEqual(["job-1", "job-2", "job-3"]);
  });
});
