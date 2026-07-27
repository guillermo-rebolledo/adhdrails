import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureInboxItem,
  createThought,
  deleteThoughtLocally,
  finalizeThoughtDeletion,
  restoreThought,
  updateThought,
} from "./commands";
import { RailsDatabase } from "./db";

function freshDatabase(): RailsDatabase {
  return new RailsDatabase(`test-${crypto.randomUUID()}`);
}

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

describe("captureInboxItem", () => {
  it("atomically writes the Inbox Item and its outbox entry", async () => {
    db = freshDatabase();

    const item = await captureInboxItem(db, "  Buy milk  ");

    expect(item).toMatchObject({
      title: "Buy milk",
      seen: false,
      version: 1,
      syncState: "pending",
    });

    const storedItem = await db.inboxItems.get(item.id);
    expect(storedItem?.title).toBe("Buy milk");

    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entity: "inbox_item",
      operation: "create",
      entityId: item.id,
      status: "pending",
      baseVersion: null,
    });
    expect(outbox[0].payload).toMatchObject({ id: item.id, title: "Buy milk" });
    // The outbox entry's idempotency key is what makes a retry safe.
    expect(outbox[0].idempotencyKey).toEqual(outbox[0].payload.idempotencyKey);
  });

  it("rejects an empty capture without writing anything", async () => {
    db = freshDatabase();

    await expect(captureInboxItem(db, "   ")).rejects.toThrow();

    expect(await db.inboxItems.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("Thought commands", () => {
  it("atomically creates a Thought and its offline mutation", async () => {
    db = freshDatabase();

    const thought = await createThought(db, {
      title: "  A useful reference  ",
      body: "  Keep this nearby.  ",
    });

    expect(thought).toMatchObject({
      title: "A useful reference",
      body: "Keep this nearby.",
      version: 1,
      deletedAt: null,
      syncState: "pending",
    });
    expect(await db.thoughts.get(thought.id)).toEqual(thought);
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({
        entity: "thought",
        operation: "create",
        entityId: thought.id,
        baseVersion: null,
      }),
    ]);
  });

  it("queues edits and reversible deletion tombstones", async () => {
    db = freshDatabase();
    const thought = await createThought(db, { title: "Reference", body: "" });
    await db.outbox.clear();
    await db.thoughts.update(thought.id, { syncState: "synced" });

    const updated = await updateThought(db, thought.id, {
      title: "Updated reference",
      body: "More context",
    });
    const deleted = await deleteThoughtLocally(db, thought.id);
    const restored = await restoreThought(db, thought.id);
    await deleteThoughtLocally(db, thought.id);
    await finalizeThoughtDeletion(db, thought.id);

    expect(updated.version).toBe(2);
    expect(deleted.deletedAt).not.toBeNull();
    expect(restored).toMatchObject({ version: 2, deletedAt: null });
    expect(
      (await db.outbox.orderBy("sequence").toArray()).map(
        (entry) => entry.operation,
      ),
    ).toEqual(["update", "delete"]);
  });
});
