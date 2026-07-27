// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskResponse } from "@/domain/task/task";

import { createTask, updateTask } from "./task-commands";
import { RailsDatabase } from "./db";
import { fetchTaskCollectionPage, reconcileTaskPage } from "./task-pull";

const ID = "11111111-1111-4111-8111-111111111111";

function serverTask(overrides: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id: ID,
    title: "Server task",
    status: "active",
    scheduledDate: null,
    scheduledTime: null,
    estimateMinutes: null,
    energy: null,
    important: false,
    notes: "",
    areaId: null,
    completedAt: null,
    version: 2,
    createdAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-27T11:00:00.000Z",
    ...overrides,
  };
}

let db: RailsDatabase;

afterEach(async () => {
  vi.unstubAllGlobals();
  await db?.delete();
});

describe("Task collection reconciliation", () => {
  it("stores server entities in Dexie while returning only view IDs to Query", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [serverTask()],
            nextCursor: "cursor-2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const page = await fetchTaskCollectionPage(db, {
      collection: "anytime",
      today: "2026-07-27",
      areaId: null,
      energy: null,
      cursor: null,
    });

    expect(page).toEqual({
      ids: [ID],
      nextCursor: "cursor-2",
      previousCursor: null,
    });
    expect(await db.tasks.get(ID)).toMatchObject({
      title: "Server task",
      version: 2,
      syncState: "synced",
    });
  });

  it("does not replace a pending optimistic edit with a server page", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const local = await createTask(
      db,
      { title: "Local title" },
      { id: ID, now: "2026-07-27T10:00:00.000Z" },
    );
    await db.tasks.update(local.id, { version: 2, syncState: "synced" });
    await db.outbox.clear();
    await updateTask(db, local.id, { title: "Pending local title" });

    await reconcileTaskPage(db, [
      serverTask({ title: "Older server title", version: 2 }),
    ]);

    expect(await db.tasks.get(ID)).toMatchObject({
      title: "Pending local title",
      syncState: "pending",
    });
  });
});
