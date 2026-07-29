import { describe, expect, it, vi } from "vitest";

import type { DataExportSource } from "@/domain/account/data-export";

import type { DataExportRecord } from "./data-export-repository";
import { runDataExportJob } from "./run-data-export-job";

function record(overrides: Partial<DataExportRecord> = {}): DataExportRecord {
  return {
    id: "export_1",
    userId: "user_1",
    status: "pending",
    byteSize: null,
    attempts: 0,
    lastErrorCode: null,
    requestedAt: new Date("2026-02-10T12:00:00.000Z"),
    completedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function source(): DataExportSource {
  return {
    account: {
      name: "Person",
      email: "person@example.com",
      timezone: "UTC",
      locale: "en-US",
    },
    areas: [],
    tasks: [],
    thoughts: [],
    inboxItems: [],
    events: [],
    focusSessions: [],
    reminderPreferences: null,
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn(),
    getLatest: vi.fn(),
    getById: vi.fn().mockResolvedValue(record()),
    getLatestCompletedDownload: vi.fn(),
    listPending: vi.fn(),
    markProcessing: vi.fn().mockResolvedValue(undefined),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    expireCompleted: vi.fn(),
    collectAccountData: vi.fn().mockResolvedValue(source()),
    ...overrides,
  };
}

describe("runDataExportJob", () => {
  it("skips an unknown job", async () => {
    const repo = repository({ getById: vi.fn().mockResolvedValue(null) });
    const result = await runDataExportJob({ repository: repo as never }, "x");

    expect(result).toEqual({ status: "skipped", reason: "unknown_job" });
    expect(repo.markProcessing).not.toHaveBeenCalled();
  });

  it("short-circuits a finished job so a retry never double-produces", async () => {
    const repo = repository({
      getById: vi.fn().mockResolvedValue(record({ status: "completed" })),
    });
    const result = await runDataExportJob(
      { repository: repo as never },
      "export_1",
    );

    expect(result).toEqual({ status: "skipped", reason: "already_finished" });
    expect(repo.markProcessing).not.toHaveBeenCalled();
  });

  it("assembles and stores the archive with a bounded window", async () => {
    const repo = repository();
    const now = () => new Date("2026-02-10T12:00:00.000Z");

    const result = await runDataExportJob(
      { repository: repo as never, now },
      "export_1",
    );

    expect(result.status).toBe("completed");
    expect(repo.markProcessing).toHaveBeenCalledWith("export_1");
    const [, input] = repo.markCompleted.mock.calls[0];
    expect(input.byteSize).toBeGreaterThan(0);
    expect(JSON.parse(input.payload).schemaVersion).toBe(1);
    // 24h TTL after the export instant.
    expect(input.expiresAt.toISOString()).toBe("2026-02-11T12:00:00.000Z");
  });

  it("fails safely when the account is gone", async () => {
    const repo = repository({
      collectAccountData: vi.fn().mockResolvedValue(null),
    });
    const result = await runDataExportJob(
      { repository: repo as never },
      "export_1",
    );

    expect(result).toEqual({
      status: "failed",
      userId: "user_1",
      reason: "account_missing",
    });
    expect(repo.markFailed).toHaveBeenCalledWith("export_1", "account_missing");
  });
});
