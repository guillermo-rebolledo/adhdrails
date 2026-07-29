import { describe, expect, it, vi } from "vitest";

import { createRecordingDataExportDispatcher } from "./data-export-dispatcher";
import type { DataExportRecord } from "./data-export-repository";
import { createDataExportService } from "./data-export-service";

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

function repository(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn(),
    getLatest: vi.fn(),
    getById: vi.fn(),
    getLatestCompletedDownload: vi.fn(),
    listPending: vi.fn(),
    markProcessing: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    expireCompleted: vi.fn(),
    collectAccountData: vi.fn(),
    ...overrides,
  };
}

const now = () => new Date("2026-02-10T12:00:00.000Z");

describe("createDataExportService.requestExport", () => {
  it("dispatches the durable job when a new export is created", async () => {
    const dispatcher = createRecordingDataExportDispatcher();
    const repo = repository({
      create: vi.fn().mockResolvedValue({ created: true, record: record() }),
    });
    const service = createDataExportService({
      repository: repo as never,
      dispatcher,
      now,
    });

    const result = await service.requestExport("user_1");

    expect(result.created).toBe(true);
    expect(result.status.status).toBe("pending");
    expect(dispatcher.dispatched).toEqual(["export_1"]);
  });

  it("re-arms without a second dispatch while one is in flight", async () => {
    const dispatcher = createRecordingDataExportDispatcher();
    const repo = repository({
      create: vi
        .fn()
        .mockResolvedValue({ created: false, record: record({ attempts: 1 }) }),
    });
    const service = createDataExportService({
      repository: repo as never,
      dispatcher,
      now,
    });

    const result = await service.requestExport("user_1");

    expect(result.created).toBe(false);
    expect(dispatcher.dispatched).toEqual([]);
  });

  it("still succeeds when inline dispatch fails, leaving the drain to retry", async () => {
    const dispatcher = createRecordingDataExportDispatcher({
      failWith: new Error("inngest down"),
    });
    const repo = repository({
      create: vi.fn().mockResolvedValue({ created: true, record: record() }),
    });
    const service = createDataExportService({
      repository: repo as never,
      dispatcher,
      now,
    });

    await expect(service.requestExport("user_1")).resolves.toMatchObject({
      created: true,
      status: { status: "pending" },
    });
  });
});

describe("createDataExportService.getStatus", () => {
  it("reports a closed window as expired even before cleanup runs", async () => {
    const repo = repository({
      getLatest: vi.fn().mockResolvedValue(
        record({
          status: "completed",
          completedAt: new Date("2026-02-09T00:00:00.000Z"),
          expiresAt: new Date("2026-02-10T00:00:00.000Z"),
          byteSize: 42,
        }),
      ),
    });
    const service = createDataExportService({
      repository: repo as never,
      dispatcher: createRecordingDataExportDispatcher(),
      now,
    });

    const status = await service.getStatus("user_1");
    expect(status.status).toBe("expired");
  });

  it("reports none when no export was ever requested", async () => {
    const repo = repository({ getLatest: vi.fn().mockResolvedValue(null) });
    const service = createDataExportService({
      repository: repo as never,
      dispatcher: createRecordingDataExportDispatcher(),
      now,
    });

    const status = await service.getStatus("user_1");
    expect(status.status).toBe("none");
  });
});

describe("createDataExportService.getDownload", () => {
  it("returns the archive with a dated filename", async () => {
    const repo = repository({
      getLatestCompletedDownload: vi.fn().mockResolvedValue({
        payload: '{"schemaVersion":1}',
        completedAt: new Date("2026-02-09T08:00:00.000Z"),
        expiresAt: new Date("2026-02-11T08:00:00.000Z"),
      }),
    });
    const service = createDataExportService({
      repository: repo as never,
      dispatcher: createRecordingDataExportDispatcher(),
      now,
    });

    const result = await service.getDownload("user_1");
    expect(result).toEqual({
      ok: true,
      payload: '{"schemaVersion":1}',
      filename: "rails-export-2026-02-09.json",
    });
  });

  it("reports not_found when there is no completed archive", async () => {
    const repo = repository({
      getLatestCompletedDownload: vi.fn().mockResolvedValue(null),
    });
    const service = createDataExportService({
      repository: repo as never,
      dispatcher: createRecordingDataExportDispatcher(),
      now,
    });

    await expect(service.getDownload("user_1")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("reports expired once the download window has closed", async () => {
    const repo = repository({
      getLatestCompletedDownload: vi.fn().mockResolvedValue({
        payload: "{}",
        completedAt: new Date("2026-02-08T00:00:00.000Z"),
        expiresAt: new Date("2026-02-09T00:00:00.000Z"),
      }),
    });
    const service = createDataExportService({
      repository: repo as never,
      dispatcher: createRecordingDataExportDispatcher(),
      now,
    });

    await expect(service.getDownload("user_1")).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("drainPendingDataExports", () => {
  it("dispatches pending jobs oldest first", async () => {
    const { drainPendingDataExports } =
      await import("./data-export-dispatcher");
    const dispatcher = createRecordingDataExportDispatcher();
    const repo = repository({
      listPending: vi
        .fn()
        .mockResolvedValue([record({ id: "a" }), record({ id: "b" })]),
    });

    const dispatched = await drainPendingDataExports({
      repository: repo as never,
      dispatcher,
    });

    expect(dispatched).toBe(2);
    expect(dispatcher.dispatched).toEqual(["a", "b"]);
  });
});
