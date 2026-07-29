import { describe, expect, it, vi } from "vitest";

import type { DataExportStatusResponse } from "@/domain/account/data-export";

import { createDataExportRouteHandlers } from "./route";

function status(
  overrides: Partial<DataExportStatusResponse> = {},
): DataExportStatusResponse {
  return {
    status: "pending",
    requestedAt: "2026-02-10T12:00:00.000Z",
    completedAt: null,
    expiresAt: null,
    byteSize: null,
    errorCode: null,
    ...overrides,
  };
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    requestExport: vi.fn(),
    getStatus: vi.fn(),
    getDownload: vi.fn(),
    ...overrides,
  };
}

const post = () =>
  new Request("https://rails.example/api/v1/account/data-export", {
    method: "POST",
  });
const get = () =>
  new Request("https://rails.example/api/v1/account/data-export");

describe("GET /api/v1/account/data-export", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { GET } = createDataExportRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(get());
    expect(response.status).toBe(401);
  });

  it("returns the account's export status", async () => {
    const getStatus = vi.fn().mockResolvedValue(status({ status: "none" }));
    const { GET } = createDataExportRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ getStatus }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(getStatus).toHaveBeenCalledWith("user_1");
    await expect(response.json()).resolves.toMatchObject({ status: "none" });
  });
});

describe("POST /api/v1/account/data-export", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { POST } = createDataExportRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post());
    expect(response.status).toBe(401);
  });

  it("accepts a new export with 202", async () => {
    const requestExport = vi
      .fn()
      .mockResolvedValue({ created: true, status: status() });
    const { POST } = createDataExportRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ requestExport }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post());
    expect(response.status).toBe(202);
    expect(requestExport).toHaveBeenCalledWith("user_1");
    await expect(response.json()).resolves.toMatchObject({ status: "pending" });
  });

  it("re-arms an in-flight export with 200", async () => {
    const requestExport = vi
      .fn()
      .mockResolvedValue({ created: false, status: status() });
    const { POST } = createDataExportRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ requestExport }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post());
    expect(response.status).toBe(200);
  });
});
