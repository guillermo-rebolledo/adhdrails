// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { RailsDatabase, type LocalThought } from "./db";
import { reconcilers } from "./entities";

const ID = "11111111-1111-4111-8111-111111111111";

function localThought(overrides: Partial<LocalThought> = {}): LocalThought {
  return {
    id: ID,
    title: "Conference notes",
    body: "",
    sourceInboxItemId: null,
    version: 2,
    deletedAt: null,
    createdAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-27T10:00:00.000Z",
    syncState: "pending",
    ...overrides,
  };
}

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

describe("thought reconciler applyServer", () => {
  it("preserves an in-flight optimistic deletion when a confirmation lands", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    // The user edited (v2) then deleted locally; the edit's confirmation is now
    // arriving from the server, which still has the Thought (deletedAt null).
    await db.thoughts.add(
      localThought({ version: 2, deletedAt: "2026-07-27T10:05:00.000Z" }),
    );

    await db.transaction("rw", db.thoughts, async () => {
      await reconcilers.thought.applyServer(db, ID, {
        id: ID,
        title: "Updated conference notes",
        body: "",
        sourceInboxItemId: null,
        version: 2,
        deletedAt: null,
        createdAt: "2026-07-27T10:00:00.000Z",
        updatedAt: "2026-07-27T10:06:00.000Z",
      });
    });

    const local = await db.thoughts.get(ID);
    // The deletion survives — the Thought is not resurrected mid-undo.
    expect(local?.deletedAt).toBe("2026-07-27T10:05:00.000Z");
    // Confirmed server fields still applied.
    expect(local?.title).toBe("Updated conference notes");
    expect(local?.syncState).toBe("synced");
  });
});
