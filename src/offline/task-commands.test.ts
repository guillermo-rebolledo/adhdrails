import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { RailsDatabase } from "./db";
import {
  completeTask,
  createTask,
  deleteTaskLocally,
  finalizeTaskDeletion,
  restoreTask,
  uncompleteTask,
  updateTask,
} from "./task-commands";

function freshDatabase(): RailsDatabase {
  return new RailsDatabase(`test-${crypto.randomUUID()}`);
}

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

describe("createTask", () => {
  it("atomically writes the Task and its create outbox entry", async () => {
    db = freshDatabase();

    const task = await createTask(db, { title: "  Write the report  " });

    expect(task).toMatchObject({
      title: "Write the report",
      status: "active",
      version: 1,
      deletedAt: null,
      syncState: "pending",
    });

    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entity: "task",
      operation: "create",
      entityId: task.id,
      baseVersion: null,
    });
    expect(outbox[0].payload).toMatchObject({
      id: task.id,
      title: "Write the report",
    });
  });

  it("rejects an empty title without writing anything", async () => {
    db = freshDatabase();

    await expect(createTask(db, { title: "   " })).rejects.toThrow();

    expect(await db.tasks.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("updateTask", () => {
  it("edits fields and queues a single update carrying the base version", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Draft" });
    await db.tasks.update(task.id, { version: 4, syncState: "synced" });
    await db.outbox.clear();

    await updateTask(db, task.id, { title: "Final draft" });

    const stored = await db.tasks.get(task.id);
    expect(stored).toMatchObject({
      title: "Final draft",
      syncState: "pending",
    });

    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ operation: "update", baseVersion: 4 });
    expect(outbox[0].payload).toMatchObject({
      baseVersion: 4,
      patch: { title: "Final draft" },
    });
  });

  it("coalesces repeated pending edits into one entry", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Draft" });
    await db.tasks.update(task.id, { version: 2, syncState: "synced" });
    await db.outbox.clear();

    await updateTask(db, task.id, { title: "Second" });
    await updateTask(db, task.id, { status: "completed" });

    const updates = await db.outbox
      .filter((entry) => entry.operation === "update")
      .toArray();
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.patch).toEqual({
      title: "Second",
      status: "completed",
    });
    // The base version stays the one from before the first edit.
    expect(updates[0].baseVersion).toBe(2);
  });
});

describe("completeTask / uncompleteTask", () => {
  it("stamps completedAt on completion and clears it on undo", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Ship it" });

    await completeTask(db, task.id, { now: "2026-07-26T12:00:00.000Z" });
    let stored = await db.tasks.get(task.id);
    expect(stored).toMatchObject({
      status: "completed",
      completedAt: "2026-07-26T12:00:00.000Z",
    });

    await uncompleteTask(db, task.id);
    stored = await db.tasks.get(task.id);
    expect(stored).toMatchObject({ status: "active", completedAt: null });
  });
});

describe("deleteTaskLocally / restoreTask / finalizeTaskDeletion", () => {
  it("hides a task optimistically without queuing a delete", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Delete me" });

    await deleteTaskLocally(db, task.id, "2026-07-26T12:00:00.000Z");

    const stored = await db.tasks.get(task.id);
    expect(stored?.deletedAt).toBe("2026-07-26T12:00:00.000Z");
    // No delete is queued during the Undo window.
    const deletes = await db.outbox
      .filter((entry) => entry.operation === "delete")
      .toArray();
    expect(deletes).toHaveLength(0);
  });

  it("restores a task within the Undo window", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Keep me" });
    await deleteTaskLocally(db, task.id);

    await restoreTask(db, task.id);

    expect((await db.tasks.get(task.id))?.deletedAt).toBeNull();
  });

  it("finalizing removes the row and queues one idempotent delete", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Gone soon" });
    await db.tasks.update(task.id, { version: 3, syncState: "synced" });
    await db.outbox.clear();
    await deleteTaskLocally(db, task.id);

    await finalizeTaskDeletion(db, task.id);

    expect(await db.tasks.get(task.id)).toBeUndefined();
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entity: "task",
      operation: "delete",
      entityId: task.id,
      baseVersion: 3,
    });
  });

  it("finalizing supersedes a queued create so nothing is left behind", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Created then deleted" });

    await finalizeTaskDeletion(db, task.id);

    // The pending create is dropped; only the delete remains.
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].operation).toBe("delete");
    expect(await db.tasks.get(task.id)).toBeUndefined();
  });
});
