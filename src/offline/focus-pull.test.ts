import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import type { FocusSessionResponse } from "@/domain/focus/session";

import { RailsDatabase, type LocalFocusSession } from "./db";
import { reconcileActiveFocusSession } from "./focus-pull";

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-27T15:00:00.000Z";

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

function freshDb() {
  db = new RailsDatabase(`test-${crypto.randomUUID()}`);
  return db;
}

function serverSession(
  overrides: Partial<FocusSessionResponse> = {},
): FocusSessionResponse {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    taskId: TASK_ID,
    status: "running",
    accumulatedSeconds: 0,
    lastResumedAt: "2026-07-27T14:00:00.000Z",
    distractionCount: 0,
    startedAt: "2026-07-27T14:00:00.000Z",
    completedAt: null,
    version: 1,
    createdAt: "2026-07-27T14:00:00.000Z",
    updatedAt: "2026-07-27T14:00:00.000Z",
    ...overrides,
  };
}

function localSession(
  overrides: Partial<LocalFocusSession> = {},
): LocalFocusSession {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    taskId: TASK_ID,
    status: "running",
    accumulatedSeconds: 0,
    lastResumedAt: "2026-07-27T14:00:00.000Z",
    distractionCount: 0,
    startedAt: "2026-07-27T14:00:00.000Z",
    completedAt: null,
    version: 1,
    createdAt: "2026-07-27T14:00:00.000Z",
    syncState: "synced",
    ...overrides,
  };
}

describe("reconcileActiveFocusSession", () => {
  it("hydrates the server's active session for a reopened app", async () => {
    freshDb();
    await reconcileActiveFocusSession(db, serverSession(), NOW);

    const stored = await db.focusSessions.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "running",
      syncState: "synced",
    });
  });

  it("marks a synced local session completed when it ended elsewhere", async () => {
    freshDb();
    await db.focusSessions.add(localSession());

    await reconcileActiveFocusSession(db, null, NOW);

    const stored = await db.focusSessions.get(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(stored?.status).toBe("completed");
  });

  it("leaves a pending local session alone (it has not synced yet)", async () => {
    freshDb();
    await db.focusSessions.add(localSession({ syncState: "pending" }));

    await reconcileActiveFocusSession(db, null, NOW);

    const stored = await db.focusSessions.get(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(stored?.status).toBe("running");
    expect(stored?.syncState).toBe("pending");
  });

  it("deactivates a synced local session that lost the account-wide race", async () => {
    freshDb();
    await db.focusSessions.add(localSession());

    await reconcileActiveFocusSession(db, serverSession(), NOW);

    const winner = await db.focusSessions.get(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    const loser = await db.focusSessions.get(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(winner?.status).toBe("running");
    expect(loser?.status).toBe("completed");
  });

  it("deactivates a rejected (conflicted) local session so no second row lingers", async () => {
    freshDb();
    // A start that lost the race is left in `conflict` by the outbox.
    await db.focusSessions.add(localSession({ syncState: "conflict" }));

    await reconcileActiveFocusSession(db, serverSession(), NOW);

    const loser = await db.focusSessions.get(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(loser?.status).toBe("completed");
    // Exactly one active session remains in the replica.
    const active = await db.focusSessions
      .filter((session) => session.status !== "completed")
      .toArray();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});
