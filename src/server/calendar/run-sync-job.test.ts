import { describe, expect, it, vi } from "vitest";

import type { IncrementalSyncService } from "./incremental-sync-service";
import { runIncrementalSyncJob } from "./run-sync-job";
import type { CalendarSyncJobRepository } from "./sync-job-repository";

function deps(
  job: {
    id: string;
    userId: string;
    googleCalendarId: string;
    status: string;
  } | null,
  syncResult: Awaited<ReturnType<IncrementalSyncService["syncCalendar"]>>,
) {
  const calls = {
    processing: [] as string[],
    completed: [] as string[],
    failed: [] as { id: string; code: string }[],
  };
  const syncJobRepository = {
    async getById() {
      return job;
    },
    async markProcessing(id: string) {
      calls.processing.push(id);
    },
    async markCompleted(id: string) {
      calls.completed.push(id);
    },
    async markFailed(id: string, code: string) {
      calls.failed.push({ id, code });
    },
  } as unknown as CalendarSyncJobRepository;

  const syncCalendar = vi.fn().mockResolvedValue(syncResult);
  const incrementalSyncService = {
    syncCalendar,
  } as unknown as IncrementalSyncService;

  return { syncJobRepository, incrementalSyncService, calls, syncCalendar };
}

const pendingJob = {
  id: "job-1",
  userId: "user_1",
  googleCalendarId: "primary@example.com",
  status: "pending",
};

describe("runIncrementalSyncJob", () => {
  it("marks a job processing, runs the sync, and marks it completed", async () => {
    const d = deps(pendingJob, {
      ok: true,
      changed: 2,
      removed: 1,
      recovered: false,
      lastSyncedAt: "2026-07-28T12:00:00.000Z",
    });

    const result = await runIncrementalSyncJob(d, "job-1");

    expect(result).toEqual({
      status: "completed",
      userId: "user_1",
      changed: 2,
      removed: 1,
      recovered: false,
    });
    expect(d.calls.processing).toEqual(["job-1"]);
    expect(d.calls.completed).toEqual(["job-1"]);
    expect(d.syncCalendar).toHaveBeenCalledWith(
      "user_1",
      "primary@example.com",
    );
  });

  it("skips an unknown job", async () => {
    const d = deps(null, {
      ok: true,
      changed: 0,
      removed: 0,
      recovered: false,
      lastSyncedAt: "x",
    });
    expect(await runIncrementalSyncJob(d, "missing")).toEqual({
      status: "skipped",
      reason: "unknown_job",
    });
    expect(d.syncCalendar).not.toHaveBeenCalled();
  });

  it("short-circuits an already-completed job so a retry never re-syncs", async () => {
    const d = deps(
      { ...pendingJob, status: "completed" },
      { ok: true, changed: 0, removed: 0, recovered: false, lastSyncedAt: "x" },
    );
    expect(await runIncrementalSyncJob(d, "job-1")).toEqual({
      status: "skipped",
      reason: "already_completed",
    });
    expect(d.calls.processing).toEqual([]);
    expect(d.syncCalendar).not.toHaveBeenCalled();
  });

  it("records a safe failure code for a terminal sync outcome", async () => {
    const d = deps(pendingJob, { ok: false, reason: "unauthorized" });

    const result = await runIncrementalSyncJob(d, "job-1");

    expect(result).toEqual({
      status: "failed",
      userId: "user_1",
      reason: "unauthorized",
    });
    expect(d.calls.failed).toEqual([{ id: "job-1", code: "unauthorized" }]);
    expect(d.calls.completed).toEqual([]);
  });

  it("lets a genuine exception propagate so the durable runner can retry", async () => {
    const d = deps(pendingJob, {
      ok: true,
      changed: 0,
      removed: 0,
      recovered: false,
      lastSyncedAt: "x",
    });
    d.syncCalendar.mockRejectedValueOnce(new Error("network down"));

    await expect(runIncrementalSyncJob(d, "job-1")).rejects.toThrow(
      "network down",
    );
    // The attempt was counted; no terminal state was written.
    expect(d.calls.processing).toEqual(["job-1"]);
    expect(d.calls.failed).toEqual([]);
    expect(d.calls.completed).toEqual([]);
  });
});
