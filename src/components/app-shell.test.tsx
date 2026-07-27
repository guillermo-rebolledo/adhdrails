// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";

describe("application shell", () => {
  it("provides the required destinations in desktop and mobile navigation", async () => {
    const user = userEvent.setup();

    render(
      <AppShell>
        <h1>Today</h1>
      </AppShell>,
    );

    const desktopNavigation = screen.getByRole("navigation", {
      name: "Primary",
    });
    expect(desktopNavigation).toHaveTextContent("Today");
    expect(desktopNavigation).toHaveTextContent("Inbox");
    expect(desktopNavigation).toHaveTextContent("Tasks");
    expect(desktopNavigation).toHaveTextContent("Calendar");
    expect(desktopNavigation).toHaveTextContent("Thoughts");
    expect(desktopNavigation).toHaveTextContent("Search");
    expect(desktopNavigation).toHaveTextContent("Settings");
    expect(screen.getAllByRole("main")).toHaveLength(1);

    await user.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Navigation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Calendar", hidden: false }),
    ).toHaveAttribute("href", "/calendar");
  });
});
