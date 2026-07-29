// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSettingsForm } from "./account-settings-form";

const fetchMock = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

describe("AccountSettingsForm", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    refresh.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uses the shared profile validation before saving", async () => {
    const user = userEvent.setup();
    render(
      <AccountSettingsForm
        initialLocale="en-US"
        initialTimezone="America/New_York"
      />,
    );

    await user.clear(screen.getByRole("textbox", { name: "Time zone" }));
    await user.type(
      screen.getByRole("textbox", { name: "Time zone" }),
      "Nowhere/Void",
    );
    await user.clear(
      screen.getByRole("textbox", { name: "Date and time format" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Date and time format" }),
      "@@",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Unknown time zone.")).toBeVisible();
    expect(screen.getByText("Unknown locale.")).toBeVisible();
  });

  it("announces the standard server error without discarding the edit", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      Response.json(
        {
          type: "https://rails.app/problems/database-unavailable",
          title: "Temporarily unavailable",
          status: 503,
          code: "database_unavailable",
          detail: "Please try again.",
          correlationId: "settings-test",
          retryable: true,
        },
        { status: 503 },
      ),
    );
    render(
      <AccountSettingsForm
        initialLocale="en-US"
        initialTimezone="America/New_York"
      />,
    );

    const timezone = screen.getByRole("textbox", { name: "Time zone" });
    await user.clear(timezone);
    await user.type(timezone, "Europe/Madrid");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please try again.",
    );
    expect(timezone).toHaveValue("Europe/Madrid");
  });
});
