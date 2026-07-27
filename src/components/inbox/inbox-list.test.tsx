// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureInboxItem } from "@/offline/commands";
import { RailsDatabase } from "@/offline/db";

import { InboxList } from "./inbox-list";

vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return { ...actual, useOffline: () => ({ db, sync: vi.fn() }) };
});

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

describe("InboxList", () => {
  it("shows a calm empty state when there is nothing captured", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    render(<InboxList />);

    expect(await screen.findByText(/your inbox is calm/i)).toBeInTheDocument();
  });

  it("observes captures from Dexie with an accessible pending status", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await captureInboxItem(db, "Buy milk");
    render(<InboxList />);

    const item = await screen.findByText("Buy milk");
    expect(item).toBeInTheDocument();
    expect(screen.getByText("Pending sync")).toBeInTheDocument();
  });

  it("surfaces a conflict as a review status", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const item = await captureInboxItem(db, "Buy milk");
    await db.inboxItems.update(item.id, { syncState: "conflict" });
    render(<InboxList />);

    expect(await screen.findByText("Needs review")).toBeInTheDocument();
  });

  it("creates a Thought from an Inbox Item", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await captureInboxItem(db, "Reference to keep");
    const user = userEvent.setup();
    render(<InboxList />);

    await user.click(
      await screen.findByRole("button", { name: "Save as Thought" }),
    );

    expect(await db.thoughts.toArray()).toEqual([
      expect.objectContaining({
        title: "Reference to keep",
        sourceInboxItemId: expect.any(String),
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Saved as a Thought.",
      ),
    );
  });
});
