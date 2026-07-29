// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DataExportStatusResponse } from "@/domain/account/data-export";

import { DataPrivacySettings } from "./data-privacy-settings";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

function status(
  overrides: Partial<DataExportStatusResponse> = {},
): DataExportStatusResponse {
  return {
    status: "none",
    requestedAt: null,
    completedAt: null,
    expiresAt: null,
    byteSize: null,
    errorCode: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, statusCode = 200) {
  return {
    ok,
    status: statusCode,
    json: async () => body,
  } as Response;
}

describe("DataPrivacySettings", () => {
  it("requests an export and shows the preparing state", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(status({ status: "pending" }), true, 202),
    );
    render(<DataPrivacySettings initialStatus={status()} />);

    await userEvent.click(screen.getByTestId("request-export"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/account/data-export",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/preparing/i),
    );
  });

  it("offers a download when an export is ready", () => {
    render(
      <DataPrivacySettings
        initialStatus={status({
          status: "completed",
          completedAt: "2026-02-09T08:00:00.000Z",
          expiresAt: "2026-02-10T08:00:00.000Z",
          byteSize: 128,
        })}
      />,
    );

    const download = screen.getByTestId("download-export");
    expect(download).toHaveAttribute(
      "href",
      "/api/v1/account/data-export/download",
    );
    expect(screen.getByRole("status")).toHaveTextContent(/ready/i);
  });

  it("surfaces a calm offline message when the request cannot be sent", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<DataPrivacySettings initialStatus={status()} />);

    await userEvent.click(screen.getByTestId("request-export"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/offline/i),
    );
  });

  it("lets the user export again after a failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(status({ status: "pending" }), true, 202),
    );
    render(
      <DataPrivacySettings
        initialStatus={status({
          status: "failed",
          errorCode: "account_missing",
        })}
      />,
    );

    expect(screen.getByTestId("request-export")).toHaveTextContent(
      /export again/i,
    );
    await userEvent.click(screen.getByTestId("request-export"));
    expect(fetchMock).toHaveBeenCalled();
  });
});
