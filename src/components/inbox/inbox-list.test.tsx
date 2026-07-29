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

function freshDatabase(): RailsDatabase {
  return new RailsDatabase(`test-${crypto.randomUUID()}`);
}

describe("InboxList", () => {
  it("shows a calm empty state when there is nothing captured", async () => {
    db = freshDatabase();
    render(<InboxList />);

    expect(await screen.findByText(/your inbox is calm/i)).toBeInTheDocument();
  });

  it("observes captures from Dexie with an accessible pending status", async () => {
    db = freshDatabase();
    await captureInboxItem(db, "Buy milk");
    render(<InboxList />);

    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
    expect(screen.getByText("Pending sync")).toBeInTheDocument();
  });

  it("surfaces a conflict as a review status", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Buy milk");
    await db.inboxItems.update(item.id, { syncState: "conflict" });
    render(<InboxList />);

    expect(await screen.findByText("Needs review")).toBeInTheDocument();
  });

  it("marks waiting items seen when the Inbox is opened", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Buy milk");
    render(<InboxList />);

    await screen.findByText("Buy milk");
    await waitFor(async () =>
      expect((await db.inboxItems.get(item.id))?.seen).toBe(true),
    );
  });

  it("focuses and identifies an Inbox Item opened from search", async () => {
    db = freshDatabase();
    const first = await captureInboxItem(db, "First capture");
    await captureInboxItem(db, "Newest capture");
    render(<InboxList highlightedItemId={first.id} />);

    await screen.findByText("First capture");
    const result = document.getElementById(`inbox-item-${first.id}`);
    expect(result).not.toBeNull();
    await waitFor(() => expect(result).toHaveFocus());
    expect(result).toHaveAttribute("aria-current", "true");
    expect(screen.getAllByRole("listitem")[0]).toBe(result);
  });

  it("classifies an item as a Thought", async () => {
    db = freshDatabase();
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
      expect(screen.getByText("Saved as a Thought.")).toBeInTheDocument(),
    );
  });

  it("classifies an item as a Task", async () => {
    db = freshDatabase();
    await captureInboxItem(db, "Email the accountant");
    const user = userEvent.setup();
    render(<InboxList />);

    await user.click(
      await screen.findByRole("button", { name: "Turn into task" }),
    );

    expect(await db.tasks.toArray()).toEqual([
      expect.objectContaining({
        title: "Email the accountant",
        status: "active",
      }),
    ]);
  });

  it("prefills detected schedule and converts to a calendar Event after confirming", async () => {
    db = freshDatabase();
    await captureInboxItem(db, "Dentist on 2027-01-15 at 9am");
    const user = userEvent.setup();
    render(<InboxList timeZone="UTC" locale="en-US" />);

    // Detected details are prefilled as chips during processing.
    expect(
      await screen.findByLabelText("Detected details"),
    ).toBeInTheDocument();

    // Converting to an Event explains its Calendar consequence before it occurs.
    await user.click(
      await screen.findByRole("button", { name: "Make an event" }),
    );
    expect(screen.getByText(/added to your calendar/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add to calendar" }));

    const events = await db.events.toArray();
    expect(events).toEqual([
      expect.objectContaining({ origin: "local", status: "confirmed" }),
    ]);
    expect(events[0].title).toBe("Dentist");
  });

  it("cannot make an event when no time is detected", async () => {
    db = freshDatabase();
    await captureInboxItem(db, "Read a good book");
    render(<InboxList timeZone="UTC" />);

    await screen.findByText("Read a good book");
    expect(
      screen.queryByRole("button", { name: "Make an event" }),
    ).not.toBeInTheDocument();
  });

  it("skips an item without penalty, leaving it in the Inbox", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Maybe later");
    const user = userEvent.setup();
    render(<InboxList />);

    await user.click(await screen.findByRole("button", { name: "Skip" }));

    await waitFor(() =>
      expect(screen.queryByText("Maybe later")).not.toBeInTheDocument(),
    );
    // The item is only set aside for this session — still stored, not deleted.
    expect(await db.inboxItems.get(item.id)).toBeDefined();
    expect((await db.inboxItems.get(item.id))?.deletedAt ?? null).toBeNull();
  });

  it("deletes an item optimistically and can undo within the window", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Accidental capture");
    const user = userEvent.setup();
    render(<InboxList undoWindowMs={10_000} />);

    await user.click(
      await screen.findByRole("button", { name: "Delete Accidental capture" }),
    );

    expect(await screen.findByText("Inbox item deleted.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Accidental capture")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Accidental capture")).toBeInTheDocument();
    expect((await db.inboxItems.get(item.id))?.deletedAt).toBeNull();
  });
});
