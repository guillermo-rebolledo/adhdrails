import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { RailsDatabase } from "./db";
import { resolveOrCreateArea } from "./area-commands";

function freshDatabase(): RailsDatabase {
  return new RailsDatabase(`test-${crypto.randomUUID()}`);
}

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

describe("resolveOrCreateArea", () => {
  it("creates a new Area and queues its create entry atomically", async () => {
    db = freshDatabase();

    const area = await resolveOrCreateArea(db, "  Work  ");

    expect(area.name).toBe("Work");
    expect(area.syncState).toBe("pending");
    expect(await db.areas.count()).toBe(1);

    const [entry] = await db.outbox.toArray();
    expect(entry).toMatchObject({
      entity: "area",
      operation: "create",
      entityId: area.id,
    });
  });

  it("reuses an existing Area by case-insensitive name instead of duplicating", async () => {
    db = freshDatabase();

    const first = await resolveOrCreateArea(db, "Work");
    const again = await resolveOrCreateArea(db, "  work ");

    expect(again.id).toBe(first.id);
    expect(await db.areas.count()).toBe(1);
    // Only the first create is queued; the reuse enqueues nothing new.
    expect(await db.outbox.count()).toBe(1);
  });
});
