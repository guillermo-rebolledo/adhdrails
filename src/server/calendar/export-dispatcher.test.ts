import { describe, expect, it, vi } from "vitest";

import type { EventExportJobRepository } from "@/server/event/export-job-repository";

import {
  EVENT_EXPORT_EVENT,
  createEventExportDispatcher,
  createRecordingExportDispatcher,
  drainPendingExportJobs,
} from "./export-dispatcher";

describe("createEventExportDispatcher", () => {
  it("sends an Inngest event carrying the job id", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createEventExportDispatcher({ send });

    await dispatcher.dispatch({ jobId: "job-1" });

    expect(send).toHaveBeenCalledWith({
      name: EVENT_EXPORT_EVENT,
      data: { jobId: "job-1" },
    });
  });
});

describe("drainPendingExportJobs", () => {
  it("dispatches every pending job, oldest first", async () => {
    const exportJobRepository = {
      listPending: vi
        .fn()
        .mockResolvedValue([{ id: "job-1" }, { id: "job-2" }]),
    } as unknown as EventExportJobRepository;
    const dispatcher = createRecordingExportDispatcher();

    const dispatched = await drainPendingExportJobs({
      exportJobRepository,
      dispatcher,
    });

    expect(dispatched).toBe(2);
    expect(dispatcher.dispatched).toEqual(["job-1", "job-2"]);
  });

  it("reports zero when nothing is pending", async () => {
    const exportJobRepository = {
      listPending: vi.fn().mockResolvedValue([]),
    } as unknown as EventExportJobRepository;

    const dispatched = await drainPendingExportJobs({
      exportJobRepository,
      dispatcher: createRecordingExportDispatcher(),
    });

    expect(dispatched).toBe(0);
  });
});
