// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ThoughtResponse } from "@/domain/thought/thought";

import { deleteThoughtLocally } from "./commands";
import { RailsDatabase, type LocalThought } from "./db";
import { pullThoughts } from "./thought-pull";

const ID = "11111111-1111-4111-8111-111111111111";

function serverThought(
  overrides: Partial<ThoughtResponse> = {},
): ThoughtResponse {
  return {
    id: ID,
    title: "Conference notes",
    body: "",
    sourceInboxItemId: null,
    version: 1,
    deletedAt: null,
    createdAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-27T10:00:00.000Z",
    ...overrides,
  };
}

function localThought(overrides: Partial<LocalThought> = {}): LocalThought {
  return {
    id: ID,
    title: "Conference notes",
    body: "",
    sourceInboxItemId: null,
    version: 1,
    deletedAt: null,
    createdAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-27T10:00:00.000Z",
    syncState: "synced",
    ...overrides,
  };
}

function stubThoughts(thoughts: ThoughtResponse[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ thoughts }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

let db: RailsDatabase;

afterEach(async () => {
  vi.unstubAllGlobals();
  await db?.delete();
});

describe("pullThoughts", () => {
  it("reconciles a newer server Thought over a synced local one", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await db.thoughts.add(localThought({ version: 1 }));
    stubThoughts([serverThought({ version: 2, title: "Updated" })]);

    await pullThoughts(db);

    expect((await db.thoughts.get(ID))?.title).toBe("Updated");
  });

  it("never resurrects a Thought deleted optimistically in its Undo window", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await db.thoughts.add(localThought({ version: 1 }));
    // The user deleted locally; the deletion is not synced, so the server still
    // returns the Thought (here even at a higher version).
    await deleteThoughtLocally(db, ID);
    stubThoughts([serverThought({ version: 5, title: "Server still has it" })]);

    await pullThoughts(db);

    const local = await db.thoughts.get(ID);
    // The optimistic deletion survives — attention is not yanked back mid-undo.
    expect(local?.deletedAt).not.toBeNull();
    expect(local?.title).toBe("Conference notes");
  });
});
