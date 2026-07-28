import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { RailsDatabase } from "./db";
import {
  captureDistraction,
  completeFocus,
  pauseFocus,
  resumeFocus,
  startFocus,
  undoFocusCompletion,
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

  it("carries the captured-distraction count on every transition", async () => {
    freshDb();
    const session = await startFocus(
      db,
      { taskId: TASK_ID },
      { now: "2026-07-27T14:00:00.000Z" },
    );
    await captureDistraction(db, session.id, "Reply to Sam", {
      now: "2026-07-27T14:00:10.000Z",
    });

    await pauseFocus(db, session.id, { now: "2026-07-27T14:00:30.000Z" });

    const update = (await db.outbox.toArray()).find(
      (entry) =>
        entry.entity === "focus_session" && entry.operation === "update",
    );
    expect(update?.payload).toMatchObject({
      status: "paused",
      distractionCount: 1,
    });
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

describe("captureDistraction", () => {
  it("saves an unseen Inbox Item and bumps the count without pausing the timer", async () => {
    freshDb();
    const session = await startFocus(
      db,
      { taskId: TASK_ID },
      { now: "2026-07-27T14:00:00.000Z" },
    );

    const { item, session: after } = await captureDistraction(
      db,
      session.id,
      "Call the dentist",
      { now: "2026-07-27T14:00:20.000Z" },
    );

    // The distraction is a normal unseen Inbox capture with its own create entry.
    expect(item).toMatchObject({ title: "Call the dentist", seen: false });
    const stored = await db.inboxItems.get(item.id);
    expect(stored?.title).toBe("Call the dentist");
    const capture = (await db.outbox.toArray()).find(
      (entry) => entry.entity === "inbox_item" && entry.operation === "create",
    );
    expect(capture?.payload).toMatchObject({ title: "Call the dentist" });

    // The session keeps running; only the count changed.
    expect(after).toMatchObject({
      status: "running",
      accumulatedSeconds: 0,
      lastResumedAt: "2026-07-27T14:00:00.000Z",
      distractionCount: 1,
    });
  });

  it("accumulates repeated distractions into one pending transition", async () => {
    freshDb();
    const session = await startFocus(
      db,
      { taskId: TASK_ID },
      { now: "2026-07-27T14:00:00.000Z" },
    );

    await captureDistraction(db, session.id, "First");
    const { session: after } = await captureDistraction(
      db,
      session.id,
      "Second",
    );
    expect(after?.distractionCount).toBe(2);

    const updates = (await db.outbox.toArray()).filter(
      (entry) =>
        entry.entity === "focus_session" && entry.operation === "update",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({ distractionCount: 2 });
    // Both distractions still reach the Inbox.
    const captures = (await db.outbox.toArray()).filter(
      (entry) => entry.entity === "inbox_item" && entry.operation === "create",
    );
    expect(captures).toHaveLength(2);
  });
});

describe("undoFocusCompletion", () => {
  it("restores the pre-completion session and drops the pending completion", async () => {
    freshDb();
    const session = await startFocus(
      db,
      { taskId: TASK_ID },
      { now: "2026-07-27T14:00:00.000Z" },
    );
    const prior = (await db.focusSessions.get(session.id))!;

    await completeFocus(db, session.id, { now: "2026-07-27T14:05:00.000Z" });
    expect((await db.focusSessions.get(session.id))?.status).toBe("completed");

    await undoFocusCompletion(db, prior);

    const restored = await db.focusSessions.get(session.id);
    expect(restored).toEqual(prior);
    expect(restored?.status).toBe("running");
    // No completion transition is left queued to flush.
    const updates = (await db.outbox.toArray()).filter(
      (entry) =>
        entry.entity === "focus_session" && entry.operation === "update",
    );
    expect(updates).toHaveLength(0);
  });
});
