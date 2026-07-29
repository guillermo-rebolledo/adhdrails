import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureInboxItem,
  classifyInboxItemAsEvent,
  classifyInboxItemAsTask,
  classifyInboxItemAsThought,
  createThought,
  deleteInboxItemLocally,
  deleteThoughtLocally,
  finalizeInboxItemDeletion,
  finalizeThoughtDeletion,
  markInboxItemsSeen,
  restoreInboxItem,
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

describe("Inbox classification commands", () => {
  it("converts an item into a Task and marks the source classified", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Call the dentist tomorrow");
    await db.outbox.clear();

    const task = await classifyInboxItemAsTask(db, item, {
      title: "Call the dentist",
    });

    expect(task).toMatchObject({ title: "Call the dentist", status: "active" });
    // The source row is retained (recoverable), only stamped classified.
    const source = await db.inboxItems.get(item.id);
    expect(source?.classifiedAt).toEqual(expect.any(String));
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ entity: "task", operation: "create" }),
    ]);
  });

  it("converts an item into a local timed Event carrying its schedule", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Standup at 9am");
    await db.outbox.clear();

    const event = await classifyInboxItemAsEvent(db, item, {
      title: "Standup",
      startAt: "2026-07-28T09:00:00.000Z",
      timeZone: "UTC",
      durationMinutes: 15,
    });

    expect(event).toMatchObject({
      title: "Standup",
      startAt: "2026-07-28T09:00:00.000Z",
      origin: "local",
      status: "confirmed",
    });
    expect((await db.inboxItems.get(item.id))?.classifiedAt).toEqual(
      expect.any(String),
    );
    expect(await db.events.count()).toBe(1);
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ entity: "event", operation: "create" }),
    ]);
  });

  it("converts an item into a Thought linked back to its source", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Reference to keep");
    await db.outbox.clear();

    const thought = await classifyInboxItemAsThought(db, item);

    expect(thought.sourceInboxItemId).toBe(item.id);
    expect((await db.inboxItems.get(item.id))?.classifiedAt).toEqual(
      expect.any(String),
    );
  });
});

describe("markInboxItemsSeen", () => {
  it("marks every unseen item seen and queues one idempotent update each", async () => {
    db = freshDatabase();
    const first = await captureInboxItem(db, "First");
    const second = await captureInboxItem(db, "Second");
    await db.outbox.clear();

    await markInboxItemsSeen(db);

    expect((await db.inboxItems.get(first.id))?.seen).toBe(true);
    expect((await db.inboxItems.get(second.id))?.seen).toBe(true);
    const updates = await db.outbox.toArray();
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      entity: "inbox_item",
      operation: "update",
      baseVersion: 1,
    });
    expect(updates[0].payload).toMatchObject({ patch: { seen: true } });
  });

  it("does not double-queue when run twice and skips deleted items", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Keep");
    const gone = await captureInboxItem(db, "Deleting");
    await deleteInboxItemLocally(db, gone.id);
    await db.outbox.clear();

    await markInboxItemsSeen(db);
    await markInboxItemsSeen(db);

    const updates = await db.outbox
      .filter((entry) => entry.operation === "update")
      .toArray();
    expect(updates).toHaveLength(1);
    expect(updates[0].entityId).toBe(item.id);
  });
});

describe("Inbox deletion with Undo", () => {
  it("hides optimistically, restores, then finalizes with a tombstone delete", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Accidental capture");
    await db.outbox.clear();

    await deleteInboxItemLocally(db, item.id);
    expect((await db.inboxItems.get(item.id))?.deletedAt).toEqual(
      expect.any(String),
    );

    await restoreInboxItem(db, item.id);
    expect((await db.inboxItems.get(item.id))?.deletedAt).toBeNull();

    await deleteInboxItemLocally(db, item.id);
    await finalizeInboxItemDeletion(db, item.id);

    expect(await db.inboxItems.get(item.id)).toBeUndefined();
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({
        entity: "inbox_item",
        operation: "delete",
        entityId: item.id,
        baseVersion: 1,
      }),
    ]);
  });

  it("drops superseded pending mutations when finalizing", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Queued then deleted");
    // The create is still pending in the outbox from capture.
    expect(await db.outbox.count()).toBe(1);

    await deleteInboxItemLocally(db, item.id);
    await finalizeInboxItemDeletion(db, item.id);

    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe("delete");
  });
});
