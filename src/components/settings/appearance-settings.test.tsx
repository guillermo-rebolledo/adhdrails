// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppearanceSettings } from "./appearance-settings";

const setTheme = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme }),
}));

describe("AppearanceSettings", () => {
  it("shows System as the default and persists an explicit appearance choice", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Appearance set to Dark.",
    );
  });
});
