// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createThought } from "@/offline/commands";
import { RailsDatabase } from "@/offline/db";

import { ThoughtDetail } from "./thought-detail";

const sync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return {
    ...actual,
    useOffline: () => ({ accountId: "test", db, sync }),
  };
});

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
  sync.mockClear();
});

describe("ThoughtDetail deletion", () => {
  it("finalizes a pending deletion when the page is left during Undo", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const thought = await createThought(db, { title: "Reference", body: "" });
    await db.outbox.clear();
    await db.thoughts.update(thought.id, { syncState: "synced" });
    const user = userEvent.setup();
    const view = render(<ThoughtDetail id={thought.id} />);

    await user.click(
      await screen.findByRole("button", { name: "Delete Thought" }),
    );
    view.unmount();

    await waitFor(() =>
      expect(db.outbox.toArray()).resolves.toEqual([
        expect.objectContaining({
          entity: "thought",
          operation: "delete",
          entityId: thought.id,
        }),
      ]),
    );
    expect(sync).toHaveBeenCalled();
  });
});
