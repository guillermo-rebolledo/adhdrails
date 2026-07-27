import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { captureInboxItem } from "./commands";
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
