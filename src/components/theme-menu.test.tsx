// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ThemeMenu } from "./theme-menu";
import { ThemeProvider } from "./theme-provider";

describe("appearance menu", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("offers accessible Light, Dark, and System choices with System as default", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ThemeMenu />
      </ThemeProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Choose appearance" });
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("menuitemradio", { name: "Light" })).toBeVisible();
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toBeVisible();
    expect(
      screen.getByRole("menuitemradio", { name: "System" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
