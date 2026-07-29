// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureInboxItem, markInboxItemsSeen } from "@/offline/commands";
import { RailsDatabase } from "@/offline/db";

import { InboxBadge } from "./inbox-badge";

vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return {
    ...actual,
    useOffline: () => ({ db, sync: vi.fn() }),
    useOptionalOffline: () => ({ db, sync: vi.fn() }),
  };
});

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

function freshDatabase(): RailsDatabase {
  return new RailsDatabase(`test-${crypto.randomUUID()}`);
}

describe("InboxBadge", () => {
  it("shows nothing when there are no unseen items", async () => {
    db = freshDatabase();
    render(<InboxBadge />);

    await waitFor(() =>
      expect(
        screen.queryByTestId("inbox-unseen-badge"),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows an accessible numberless badge while unseen items exist", async () => {
    db = freshDatabase();
    await captureInboxItem(db, "Buy milk");
    render(<InboxBadge />);

    const badge = await screen.findByTestId("inbox-unseen-badge");
    // Numberless: it must not present any count.
    expect(badge.textContent).toBe("New inbox items");
    expect(screen.getByText("New inbox items")).toHaveClass("sr-only");
  });

  it("clears once the items are marked seen", async () => {
    db = freshDatabase();
    await captureInboxItem(db, "Buy milk");
    render(<InboxBadge />);

    await screen.findByTestId("inbox-unseen-badge");
    await markInboxItemsSeen(db);

    await waitFor(() =>
      expect(
        screen.queryByTestId("inbox-unseen-badge"),
      ).not.toBeInTheDocument(),
    );
  });
});
