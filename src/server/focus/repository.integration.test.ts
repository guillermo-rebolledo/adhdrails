import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseConnection } from "@/server/db/client";
import { task, user } from "@/server/db/schema";

import { createFocusSessionRepository } from "./repository";
import { createFocusSessionService } from "./service";

const DATABASE_URL = process.env.DATABASE_URL;
const USER_IDS = ["focus-owner", "focus-neighbor"];

const TASK_IDS = {
  owner: "10000000-0000-4000-8000-0000000000a1",
  ownerSecond: "10000000-0000-4000-8000-0000000000a2",
  neighbor: "10000000-0000-4000-8000-0000000000b1",
} as const;

const connection = DATABASE_URL
  ? createDatabaseConnection(DATABASE_URL)
  : undefined;

const uuid = () => crypto.randomUUID();

describe.skipIf(!connection)("Focus Session PostgreSQL integration", () => {
  beforeAll(async () => {
    await connection!.database
      .insert(user)
      .values(
        USER_IDS.map((id) => ({ id, name: id, email: `${id}@example.test` })),
      );
    await connection!.database.insert(task).values([
      {
        id: TASK_IDS.owner,
        userId: USER_IDS[0],
        title: "Owner task",
        idempotencyKey: uuid(),
      },
      {
        id: TASK_IDS.ownerSecond,
        userId: USER_IDS[0],
        title: "Owner second task",
        idempotencyKey: uuid(),
      },
      {
        id: TASK_IDS.neighbor,
        userId: USER_IDS[1],
        title: "Neighbor task",
        idempotencyKey: uuid(),
      },
    ]);
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.database.delete(user).where(inArray(user.id, USER_IDS));
    await connection.close();
  });

  function service(taskOwned = true) {
    return createFocusSessionService(
      createFocusSessionRepository(connection!.database),
      () => new Date(),
      async () => taskOwned,
    );
  }

  it("starts, persists, and resolves the count-up timer through a pause", async () => {
    const svc = service();
    const id = uuid();

    const started = await svc.start(USER_IDS[0], {
      id,
      taskId: TASK_IDS.owner,
      idempotencyKey: uuid(),
    });
    expect(started).toMatchObject({ ok: true, created: true });

    const active = await svc.getActive(USER_IDS[0]);
    expect(active).toMatchObject({ id, status: "running" });

    const paused = await svc.transition(USER_IDS[0], id, {
      idempotencyKey: uuid(),
      baseVersion: 1,
      status: "paused",
      accumulatedSeconds: 0,
      lastResumedAt: null,
      completedAt: null,
      // A distraction captured during focus rides the transition and persists.
      distractionCount: 2,
    });
    expect(paused).toMatchObject({
      ok: true,
      applied: true,
      item: {
        status: "paused",
        version: 2,
        lastResumedAt: null,
        distractionCount: 2,
      },
    });

    // Completing clears the active session so a new one may start later.
    const done = await svc.transition(USER_IDS[0], id, {
      idempotencyKey: uuid(),
      baseVersion: 2,
      status: "completed",
      accumulatedSeconds: 0,
      lastResumedAt: null,
      completedAt: new Date().toISOString(),
      distractionCount: 0,
    });
    expect(done).toMatchObject({ ok: true, item: { status: "completed" } });
    expect(await svc.getActive(USER_IDS[0])).toBeNull();
  });

  it("refuses a second, competing active session for the same account", async () => {
    const svc = service();
    const first = await svc.start(USER_IDS[0], {
      id: uuid(),
      taskId: TASK_IDS.owner,
      idempotencyKey: uuid(),
    });
    expect(first).toMatchObject({ ok: true, created: true });

    const competing = await svc.start(USER_IDS[0], {
      id: uuid(),
      taskId: TASK_IDS.ownerSecond,
      idempotencyKey: uuid(),
    });
    expect(competing.ok).toBe(false);
    if (competing.ok) throw new Error("Expected a conflict.");
    expect(competing.reason).toBe("conflict");
    if (competing.reason !== "conflict") throw new Error("Expected conflict.");
    // The conflict carries the session that is actually active.
    expect(competing.current).toMatchObject({ status: "running" });

    // Clean up so later assertions start from no active session.
    const active = await svc.getActive(USER_IDS[0]);
    await svc.transition(USER_IDS[0], active!.id, {
      idempotencyKey: uuid(),
      baseVersion: active!.version,
      status: "completed",
      accumulatedSeconds: 0,
      lastResumedAt: null,
      completedAt: new Date().toISOString(),
      distractionCount: 0,
    });
  });

  it("keeps a stale transition as a conflict without clobbering newer data", async () => {
    const svc = service();
    const id = uuid();
    await svc.start(USER_IDS[0], {
      id,
      taskId: TASK_IDS.owner,
      idempotencyKey: uuid(),
    });

    // A first pause moves the session to version 2.
    await svc.transition(USER_IDS[0], id, {
      idempotencyKey: uuid(),
      baseVersion: 1,
      status: "paused",
      accumulatedSeconds: 0,
      lastResumedAt: null,
      completedAt: null,
      distractionCount: 0,
    });

    // A second device still believes it is at version 1.
    const stale = await svc.transition(USER_IDS[0], id, {
      idempotencyKey: uuid(),
      baseVersion: 1,
      status: "completed",
      accumulatedSeconds: 0,
      lastResumedAt: null,
      completedAt: new Date().toISOString(),
      distractionCount: 0,
    });
    expect(stale).toMatchObject({ ok: false, reason: "conflict" });

    // The session is still paused (not clobbered to completed).
    expect(await svc.getActive(USER_IDS[0])).toMatchObject({
      id,
      status: "paused",
    });

    // Clean up.
    await svc.transition(USER_IDS[0], id, {
      idempotencyKey: uuid(),
      baseVersion: 2,
      status: "completed",
      accumulatedSeconds: 0,
      lastResumedAt: null,
      completedAt: new Date().toISOString(),
      distractionCount: 0,
    });
  });

  it("scopes sessions to the owning account", async () => {
    const svc = service();
    const ownerId = uuid();
    await svc.start(USER_IDS[0], {
      id: ownerId,
      taskId: TASK_IDS.owner,
      idempotencyKey: uuid(),
    });

    // The neighbor has no active session and cannot see the owner's.
    expect(await svc.getActive(USER_IDS[1])).toBeNull();
    const neighborStart = await svc.start(USER_IDS[1], {
      id: uuid(),
      taskId: TASK_IDS.neighbor,
      idempotencyKey: uuid(),
    });
    expect(neighborStart).toMatchObject({ ok: true, created: true });

    // A neighbor cannot transition the owner's session.
    const forged = await svc.transition(USER_IDS[1], ownerId, {
      idempotencyKey: uuid(),
      baseVersion: 1,
      status: "completed",
      accumulatedSeconds: 0,
      lastResumedAt: null,
      completedAt: new Date().toISOString(),
      distractionCount: 0,
    });
    expect(forged).toMatchObject({ ok: false, reason: "not_found" });
  });
});
