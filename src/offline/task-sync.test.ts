import "fake-indexeddb/auto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskResponse } from "@/domain/task/task";

import { RailsDatabase } from "./db";
import {
  completeTask,
  createTask,
  finalizeTaskDeletion,
} from "./task-commands";
import { drainOutbox, type SendResult } from "./sync";

function freshDatabase(): RailsDatabase {
  return new RailsDatabase(`test-${crypto.randomUUID()}`);
}

function serverTask(
  id: string,
  overrides: Partial<TaskResponse> = {},
): TaskResponse {
  return {
    id,
    title: "Write the report",
    status: "active",
    completedAt: null,
    version: 1,
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-26T10:00:00.000Z",
    ...overrides,
  };
}

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

describe("drainOutbox for tasks", () => {
  it("reconciles a confirmed create and clears its entry", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Write the report" });
    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({ ok: true, item: serverTask(task.id, { version: 2 }) }),
    );

    await drainOutbox({ db, send });

    expect(await db.tasks.get(task.id)).toMatchObject({
      syncState: "synced",
      version: 2,
    });
    expect(await db.outbox.count()).toBe(0);
  });

  it("applies a confirmed completion update", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Ship it" });
    await db.tasks.update(task.id, { syncState: "synced" });
    await db.outbox.clear();
    await completeTask(db, task.id);

    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({
        ok: true,
        item: serverTask(task.id, {
          status: "completed",
          completedAt: "2026-07-26T12:00:00.000Z",
          version: 2,
        }),
      }),
    );

    await drainOutbox({ db, send });

    expect(await db.tasks.get(task.id)).toMatchObject({
      status: "completed",
      version: 2,
      syncState: "synced",
    });
  });

  it("removes the local row after a confirmed delete", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Gone soon" });
    await db.tasks.update(task.id, { syncState: "synced" });
    await db.outbox.clear();
    await finalizeTaskDeletion(db, task.id);

    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({ ok: true }),
    );

    await drainOutbox({ db, send });

    expect(await db.tasks.get(task.id)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it("drops a queued mutation for a tombstoned task rather than resurrecting it", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Deleted elsewhere" });
    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({ ok: false, kind: "gone" }),
    );

    await drainOutbox({ db, send });

    expect(await db.tasks.get(task.id)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it("retains a conflicted update for review", async () => {
    db = freshDatabase();
    const task = await createTask(db, { title: "Local edit" });
    await db.tasks.update(task.id, { syncState: "synced", version: 1 });
    await db.outbox.clear();
    await completeTask(db, task.id);

    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({
        ok: false,
        kind: "conflict",
        current: serverTask(task.id, { title: "Server edit", version: 9 }),
      }),
    );

    await drainOutbox({ db, send });

    expect(await db.tasks.get(task.id)).toMatchObject({
      syncState: "conflict",
      status: "completed",
    });
    const outbox = await db.outbox.toArray();
    expect(outbox[0]).toMatchObject({
      status: "failed",
      lastError: "conflict",
    });
  });
});
