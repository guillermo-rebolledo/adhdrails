// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DataExportStatusResponse } from "@/domain/account/data-export";
import { ACCOUNT_DELETION_CONFIRMATION } from "@/domain/account/deletion";

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

  it("requires typed confirmation and waits for the server before finishing deletion", async () => {
    let resolveRequest!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const onDeletionConfirmed = vi.fn();
    render(
      <DataPrivacySettings
        initialStatus={status()}
        accountId="user_1"
        onDeletionConfirmed={onDeletionConfirmed}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Delete account" }),
    );
    const confirm = screen.getByRole("button", {
      name: "Permanently delete account",
    });
    expect(confirm).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText(/type delete my account/i),
      ACCOUNT_DELETION_CONFIRMATION,
    );
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(onDeletionConfirmed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/account/deletion",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          confirmation: ACCOUNT_DELETION_CONFIRMATION,
        }),
      }),
    );

    resolveRequest(
      jsonResponse(
        {
          id: "job_1",
          status: "pending",
          requestedAt: "2026-07-28T12:00:00.000Z",
          completedAt: null,
          errorCode: null,
        },
        true,
        202,
      ),
    );
    await waitFor(() => expect(onDeletionConfirmed).toHaveBeenCalledOnce());
  });

  it("keeps the accepted state when post-confirmation cleanup fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          id: "44d77356-5801-4cd2-b662-daeb1d7fdd74",
          status: "pending",
          requestedAt: "2026-07-28T12:00:00.000Z",
          completedAt: null,
          errorCode: null,
        },
        true,
        202,
      ),
    );
    render(
      <DataPrivacySettings
        initialStatus={status()}
        onDeletionConfirmed={() =>
          Promise.reject(new Error("navigation failed"))
        }
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Delete account" }),
    );
    await userEvent.type(
      screen.getByLabelText(/type delete my account/i),
      ACCOUNT_DELETION_CONFIRMATION,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Permanently delete account" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /deletion was confirmed/i,
      ),
    );
    expect(screen.queryByText(/reconnect before deleting/i)).toBeNull();
  });
});
