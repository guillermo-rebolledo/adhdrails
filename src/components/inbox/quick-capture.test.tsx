// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "@/offline/db";

import { QuickCapture } from "./quick-capture";

const sync = vi.fn().mockResolvedValue(undefined);

vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return { ...actual, useOffline: () => ({ db, sync }) };
});

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
  sync.mockClear();
});

describe("QuickCapture", () => {
  it("captures a title-only item and announces it accessibly", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<QuickCapture />);

    await user.type(
      screen.getByRole("textbox", { name: "Quick capture" }),
      "Buy milk",
    );
    await user.click(screen.getByRole("button", { name: "Capture" }));

    const status = await screen.findByText("Saved to Inbox.");
    expect(status).toHaveAttribute("role", "status");
    const stored = await db.inboxItems.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      title: "Buy milk",
      syncState: "pending",
    });
    expect(sync).toHaveBeenCalled();
  });

  it("clears the field and keeps focus for the next capture", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<QuickCapture />);

    const input = screen.getByRole("textbox", { name: "Quick capture" });
    await user.type(input, "First thought");
    await user.click(screen.getByRole("button", { name: "Capture" }));

    await waitFor(() => expect(input).toHaveValue(""));
    expect(input).toHaveFocus();
  });

  it("does not capture an empty or whitespace-only title", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<QuickCapture />);

    // The submit button is disabled until there is real content.
    expect(screen.getByRole("button", { name: "Capture" })).toBeDisabled();

    await user.type(
      screen.getByRole("textbox", { name: "Quick capture" }),
      "   ",
    );
    expect(screen.getByRole("button", { name: "Capture" })).toBeDisabled();
    expect(await db.inboxItems.count()).toBe(0);
  });
});
