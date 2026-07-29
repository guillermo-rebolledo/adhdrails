// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignInForm } from "./sign-in-form";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      social: vi.fn(),
    },
  },
}));

afterEach(() => {
  fetchMock.mockReset();
});

describe("SignInForm account deletion receipt", () => {
  it("shows completion from the identity-free status endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "44d77356-5801-4cd2-b662-daeb1d7fdd74",
        status: "completed",
        requestedAt: "2026-07-28T12:00:00.000Z",
        completedAt: "2026-07-28T12:01:00.000Z",
        errorCode: null,
      }),
    } as Response);

    render(
      <SignInForm
        deletionConfirmed
        deletionReceipt="44d77356-5801-4cd2-b662-daeb1d7fdd74"
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /permanently deleted/i,
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/account/deletion/44d77356-5801-4cd2-b662-daeb1d7fdd74",
      expect.objectContaining({
        headers: expect.objectContaining({
          "content-type": "application/json",
        }),
      }),
    );
  });
});
