import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { RailsDatabase } from "./db";
import {
  completeFocus,
  pauseFocus,
  resumeFocus,
  startFocus,
} from "./focus-commands";

const TASK_ID = "33333333-3333-4333-8333-333333333333";

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

function freshDb() {
  db = new RailsDatabase(`test-${crypto.randomUUID()}`);
  return db;
}

describe("startFocus", () => {
  it("writes an optimistic running session and a create outbox entry atomically", async () => {
    freshDb();
    const session = await startFocus(
      db,
      { taskId: TASK_ID },
      { now: "2026-07-27T14:00:00.000Z" },
    );

    expect(session).toMatchObject({
      taskId: TASK_ID,
      status: "running",
      accumulatedSeconds: 0,
      lastResumedAt: "2026-07-27T14:00:00.000Z",
      version: 1,
      syncState: "pending",
    });

    const stored = await db.focusSessions.get(session.id);
    expect(stored?.status).toBe("running");

    const [entry] = await db.outbox.toArray();
    expect(entry).toMatchObject({
      entity: "focus_session",
      operation: "create",
      entityId: session.id,
      baseVersion: null,
    });
    expect(entry.payload).toEqual({
      id: session.id,
      taskId: TASK_ID,
      idempotencyKey: expect.any(String),
    });
  });
});

describe("focus transitions", () => {
  it("pausing folds elapsed time and queues an update carrying the new state", async () => {
    freshDb();
    const session = await startFocus(
      db,
      { taskId: TASK_ID },
      { now: "2026-07-27T14:00:00.000Z" },
    );

    const paused = await pauseFocus(db, session.id, {
      now: "2026-07-27T14:00:30.000Z",
    });
    expect(paused).toMatchObject({
      status: "paused",
      accumulatedSeconds: 30,
      lastResumedAt: null,
      syncState: "pending",
    });

    const update = (await db.outbox.toArray()).find(
      (entry) => entry.operation === "update",
    );
    expect(update).toMatchObject({
      entity: "focus_session",
      entityId: session.id,
      baseVersion: 1,
    });
    expect(update?.payload).toMatchObject({
      status: "paused",
      accumulatedSeconds: 30,
      lastResumedAt: null,
      completedAt: null,
      baseVersion: 1,
    });
  });

  it("collapses a run of offline transitions into one last-write-wins update", async () => {
    freshDb();
    const session = await startFocus(
      db,
      { taskId: TASK_ID },
      { now: "2026-07-27T14:00:00.000Z" },
    );

    await pauseFocus(db, session.id, { now: "2026-07-27T14:00:30.000Z" });
    await resumeFocus(db, session.id, { now: "2026-07-27T14:01:00.000Z" });
    const done = await completeFocus(db, session.id, {
      now: "2026-07-27T14:01:20.000Z",
    });

    expect(done?.status).toBe("completed");
    // 30s before the pause + 20s after the resume.
    expect(done?.accumulatedSeconds).toBe(50);

    const updates = (await db.outbox.toArray()).filter(
      (entry) => entry.operation === "update",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({
      status: "completed",
      accumulatedSeconds: 50,
      baseVersion: 1,
    });
    // The create entry is still there and still first in line.
    const creates = (await db.outbox.toArray()).filter(
      (entry) => entry.operation === "create",
    );
    expect(creates).toHaveLength(1);
  });

  it("ignores an illegal transition rather than corrupting state", async () => {
    freshDb();
    const session = await startFocus(
      db,
      { taskId: TASK_ID },
      { now: "2026-07-27T14:00:00.000Z" },
    );

    // Resume is illegal while running; state and outbox are unchanged.
    const result = await resumeFocus(db, session.id, {
      now: "2026-07-27T14:00:10.000Z",
    });
    expect(result?.status).toBe("running");
    const updates = (await db.outbox.toArray()).filter(
      (entry) => entry.operation === "update",
    );
    expect(updates).toHaveLength(0);
  });
});
