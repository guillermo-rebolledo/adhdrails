import { describe, expect, it, vi } from "vitest";

import { createDataExportDownloadRouteHandlers } from "./route";

function service(overrides: Record<string, unknown> = {}) {
  return {
    requestExport: vi.fn(),
    getStatus: vi.fn(),
    getDownload: vi.fn(),
    ...overrides,
  };
}

const get = () =>
  new Request("https://rails.example/api/v1/account/data-export/download");

describe("GET /api/v1/account/data-export/download", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { GET } = createDataExportDownloadRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(get());
    expect(response.status).toBe(401);
  });

  it("streams the archive as a JSON attachment", async () => {
    const getDownload = vi.fn().mockResolvedValue({
      ok: true,
      payload: '{"schemaVersion":1}',
      filename: "rails-export-2026-02-09.json",
    });
    const { GET } = createDataExportDownloadRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ getDownload }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="rails-export-2026-02-09.json"',
    );
    await expect(response.text()).resolves.toBe('{"schemaVersion":1}');
  });

  it("returns 404 when no archive is ready", async () => {
    const getDownload = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "not_found" });
    const { GET } = createDataExportDownloadRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ getDownload }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(get());
    expect(response.status).toBe(404);
  });

  it("returns 410 Gone when the download window has closed", async () => {
    const getDownload = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "expired" });
    const { GET } = createDataExportDownloadRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ getDownload }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(get());
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ code: "gone" });
  });
});
