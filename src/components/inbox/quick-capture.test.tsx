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

    const status = await screen.findByText(/Saved to Inbox/);
    expect(status).toHaveAttribute("role", "status");
    // Plain text has no schedule, so the notice is explicit about that and
    // offers a way to add details rather than leaving the user guessing.
    expect(status).toHaveTextContent("No schedule detected");
    expect(screen.getByRole("link", { name: "Add details" })).toHaveAttribute(
      "href",
      "/tasks/new?title=Buy%20milk",
    );
    const stored = await db.inboxItems.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      title: "Buy milk",
      syncState: "pending",
    });
    expect(sync).toHaveBeenCalled();
  });

  it("shows editable chips for a detected duration and captures raw text", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<QuickCapture />);

    await user.type(
      screen.getByRole("textbox", { name: "Quick capture" }),
      "review PR about 15 minutes",
    );

    const chips = await screen.findByRole("list", { name: "Detected details" });
    expect(chips).toHaveTextContent("15 min");

    // A duration alone is not a confirmable Event.
    expect(
      screen.queryByRole("button", { name: "Confirm as event" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Capture" }));

    await screen.findByText("Saved to Inbox.");
    const stored = await db.inboxItems.toArray();
    // The raw text is retained verbatim so nothing the parser noticed is lost.
    expect(stored[0]).toMatchObject({ title: "review PR about 15 minutes" });
  });

  it("removes a chip so its value is no longer offered", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<QuickCapture />);

    await user.type(
      screen.getByRole("textbox", { name: "Quick capture" }),
      "gym for 45 min",
    );

    const remove = await screen.findByRole("button", {
      name: /Remove duration/,
    });
    await user.click(remove);

    expect(
      screen.queryByRole("list", { name: "Detected details" }),
    ).not.toBeInTheDocument();
  });

  it("withdraws Confirm as event when the explicit date is removed", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<QuickCapture timeZone="America/Los_Angeles" />);

    await user.type(
      screen.getByRole("textbox", { name: "Quick capture" }),
      "lunch tomorrow at 1pm",
    );

    // A date + time capture can be confirmed as an Event.
    expect(
      await screen.findByRole("button", { name: "Confirm as event" }),
    ).toBeInTheDocument();

    // Removing the date the user rejected must not leave an Event that would be
    // created on that very date; the confirmation is withdrawn.
    await user.click(screen.getByRole("button", { name: /Remove date/ }));
    expect(
      screen.queryByRole("button", { name: "Confirm as event" }),
    ).not.toBeInTheDocument();
  });

  it("confirms a timed capture as a local Event via the offline path", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<QuickCapture timeZone="America/Los_Angeles" />);

    await user.type(
      screen.getByRole("textbox", { name: "Quick capture" }),
      "standup at 3pm",
    );

    await user.click(
      await screen.findByRole("button", { name: "Confirm as event" }),
    );

    await screen.findByText("Added to your calendar.");
    const events = await db.events.toArray();
    expect(events).toHaveLength(1);
    // Confirming classifies it: a local Event carrying the cleaned title, queued
    // through the offline outbox. No Google write happens for a local Event.
    expect(events[0]).toMatchObject({
      title: "standup",
      origin: "local",
      syncState: "pending",
    });
    // A timed capture confirmed as an Event is not left duplicated in the Inbox.
    expect(await db.inboxItems.count()).toBe(0);
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
