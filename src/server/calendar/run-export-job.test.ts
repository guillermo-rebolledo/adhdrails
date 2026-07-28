import { describe, expect, it, vi } from "vitest";

import type {
  EventExportJobRepository,
  ExportJobRecord,
} from "@/server/event/export-job-repository";

import type { EventExportService } from "./event-export-service";
import { runEventExportJob } from "./run-export-job";

function job(overrides: Partial<ExportJobRecord> = {}): ExportJobRecord {
  return {
    id: "job-1",
    userId: "user_1",
    eventId: "11111111-1111-4111-8111-111111111111",
    operation: "upsert",
    googleCalendarId: "writable@example.com",
    googleEventId: null,
    status: "pending",
    attempts: 0,
    lastErrorCode: null,
    ...overrides,
  };
}

function jobRepository(overrides: Record<string, unknown> = {}) {
  return {
    getById: vi.fn().mockResolvedValue(job()),
    listPending: vi.fn(),
    enqueue: vi.fn(),
    markProcessing: vi.fn().mockResolvedValue(undefined),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markSkipped: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as EventExportJobRepository;
}

function exportService(
  result: Awaited<ReturnType<EventExportService["exportEvent"]>>,
): EventExportService {
  return { exportEvent: vi.fn().mockResolvedValue(result) } as never;
}

describe("runEventExportJob", () => {
  it("marks a job completed when the export lands on Google", async () => {
    const exportJobRepository = jobRepository();
    const result = await runEventExportJob(
      {
        exportJobRepository,
        exportService: exportService({ ok: true, outcome: "created" }),
      },
      "job-1",
    );

    expect(result).toEqual({ status: "completed", outcome: "created" });
    expect(exportJobRepository.markProcessing).toHaveBeenCalledWith("job-1");
    expect(exportJobRepository.markCompleted).toHaveBeenCalledWith("job-1");
  });

  it("marks a job skipped with its safe reason", async () => {
    const exportJobRepository = jobRepository();
    const result = await runEventExportJob(
      {
        exportJobRepository,
        exportService: exportService({
          ok: true,
          outcome: "skipped",
          reason: "no_writable_calendar",
        }),
      },
      "job-1",
    );

    expect(result).toEqual({
      status: "skipped",
      reason: "no_writable_calendar",
    });
    expect(exportJobRepository.markSkipped).toHaveBeenCalledWith(
      "job-1",
      "no_writable_calendar",
    );
  });

  it("marks a job failed on a terminal reason", async () => {
    const exportJobRepository = jobRepository();
    const result = await runEventExportJob(
      {
        exportJobRepository,
        exportService: exportService({ ok: false, reason: "unauthorized" }),
      },
      "job-1",
    );

    expect(result).toEqual({ status: "failed", reason: "unauthorized" });
    expect(exportJobRepository.markFailed).toHaveBeenCalledWith(
      "job-1",
      "unauthorized",
    );
  });

  it("skips an unknown job", async () => {
    const exportJobRepository = jobRepository({
      getById: vi.fn().mockResolvedValue(null),
    });
    const exportSvc = exportService({ ok: true, outcome: "created" });

    const result = await runEventExportJob(
      { exportJobRepository, exportService: exportSvc },
      "job-1",
    );

    expect(result).toEqual({ status: "skipped", reason: "unknown_job" });
    expect(exportSvc.exportEvent).not.toHaveBeenCalled();
  });

  it("short-circuits a job that already finished", async () => {
    const exportSvc = exportService({ ok: true, outcome: "created" });
    const result = await runEventExportJob(
      {
        exportJobRepository: jobRepository({
          getById: vi.fn().mockResolvedValue(job({ status: "completed" })),
        }),
        exportService: exportSvc,
      },
      "job-1",
    );

    expect(result).toEqual({ status: "skipped", reason: "already_finished" });
    expect(exportSvc.exportEvent).not.toHaveBeenCalled();
  });

  it("propagates a transient error so the durable runner retries", async () => {
    const exportSvc = {
      exportEvent: vi.fn().mockRejectedValue(new Error("google 503")),
    } as never;

    await expect(
      runEventExportJob(
        { exportJobRepository: jobRepository(), exportService: exportSvc },
        "job-1",
      ),
    ).rejects.toThrow("google 503");
  });
});
