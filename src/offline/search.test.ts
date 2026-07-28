import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { RailsDatabase } from "./db";
import { searchLocalContent } from "./search";

const databases: RailsDatabase[] = [];

function database() {
  const db = new RailsDatabase(`search-${crypto.randomUUID()}`);
  databases.push(db);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("offline search", () => {
  it("ranks exact and partial matches across Tasks, Thoughts, and Inbox Items", async () => {
    const db = database();
    await db.tasks.bulkAdd([
      {
        id: "10000000-0000-4000-8000-000000000001",
        title: "Quarterly report",
        notes: "Draft the narrative",
        status: "active",
        scheduledDate: null,
        scheduledTime: null,
        estimateMinutes: null,
        energy: null,
        important: false,
        areaId: null,
        completedAt: null,
        version: 1,
        createdAt: "2026-07-28T10:00:00.000Z",
        deletedAt: null,
        syncState: "synced",
      },
      {
        id: "10000000-0000-4000-8000-000000000002",
        title: "Quarter report receipts",
        notes: "",
        status: "active",
        scheduledDate: null,
        scheduledTime: null,
        estimateMinutes: null,
        energy: null,
        important: false,
        areaId: null,
        completedAt: null,
        version: 1,
        createdAt: "2026-07-28T09:00:00.000Z",
        deletedAt: null,
        syncState: "synced",
      },
    ]);
    await db.thoughts.add({
      id: "20000000-0000-4000-8000-000000000001",
      title: "Reporting ideas",
      body: "A visual outline",
      sourceInboxItemId: null,
      version: 1,
      deletedAt: null,
      createdAt: "2026-07-28T08:00:00.000Z",
      updatedAt: "2026-07-28T08:00:00.000Z",
      syncState: "synced",
    });
    await db.inboxItems.add({
      id: "30000000-0000-4000-8000-000000000001",
      title: "Ask Sam about the report",
      seen: false,
      version: 1,
      createdAt: "2026-07-28T07:00:00.000Z",
      syncState: "synced",
    });

    const page = await searchLocalContent(db, "quarter report");

    expect(page.items.map(({ type, title }) => ({ type, title }))).toEqual([
      { type: "task", title: "Quarter report receipts" },
      { type: "task", title: "Quarterly report" },
      { type: "inbox_item", title: "Ask Sam about the report" },
      { type: "thought", title: "Reporting ideas" },
    ]);
  });

  it("finds a typo and excludes deleted or classified content", async () => {
    const db = database();
    await db.thoughts.bulkAdd([
      {
        id: "20000000-0000-4000-8000-000000000001",
        title: "Conference notes",
        body: "",
        sourceInboxItemId: null,
        version: 1,
        deletedAt: null,
        createdAt: "2026-07-28T08:00:00.000Z",
        updatedAt: "2026-07-28T08:00:00.000Z",
        syncState: "synced",
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        title: "Conference archive",
        body: "",
        sourceInboxItemId: null,
        version: 1,
        deletedAt: "2026-07-28T09:00:00.000Z",
        createdAt: "2026-07-28T08:00:00.000Z",
        updatedAt: "2026-07-28T08:00:00.000Z",
        syncState: "synced",
      },
    ]);
    await db.inboxItems.add({
      id: "30000000-0000-4000-8000-000000000001",
      title: "Conference follow-up",
      seen: true,
      version: 1,
      classifiedAt: "2026-07-28T09:00:00.000Z",
      createdAt: "2026-07-28T07:00:00.000Z",
      syncState: "synced",
    });

    const page = await searchLocalContent(db, "conferance");

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      type: "thought",
      title: "Conference notes",
      href: "/thoughts/20000000-0000-4000-8000-000000000001",
    });
  });

  it("returns deterministic cursor pages", async () => {
    const db = database();
    await db.inboxItems.bulkAdd(
      Array.from({ length: 3 }, (_, index) => ({
        id: `30000000-0000-4000-8000-00000000000${index + 1}`,
        title: `Project note ${index + 1}`,
        seen: true,
        version: 1,
        createdAt: `2026-07-28T0${index}:00:00.000Z`,
        syncState: "synced" as const,
      })),
    );

    const first = await searchLocalContent(db, "project", undefined, 2);
    const second = await searchLocalContent(db, "project", first.nextCursor, 2);

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(second.nextCursor).toBeNull();
  });
});
