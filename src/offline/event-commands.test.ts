import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { RailsDatabase } from "./db";
import {
  createEvent,
  deleteEventLocally,
  finalizeEventDeletion,
  restoreEvent,
  updateEvent,
} from "./event-commands";

function freshDatabase(): RailsDatabase {
  return new RailsDatabase(`test-${crypto.randomUUID()}`);
}

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

const START = "2026-07-20T13:00:00Z";

describe("createEvent", () => {
  it("atomically writes a 30-minute local event and its create outbox entry", async () => {
    db = freshDatabase();

    const event = await createEvent(db, {
      title: "  Dentist  ",
      startAt: START,
      timeZone: "America/New_York",
    });

    expect(event).toMatchObject({
      title: "Dentist",
      startAt: "2026-07-20T13:00:00Z",
      endAt: "2026-07-20T13:30:00Z",
      startTimeZone: "America/New_York",
      isAllDay: false,
      status: "confirmed",
      origin: "local",
      version: 1,
      deletedAt: null,
      syncState: "pending",
    });

    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entity: "event",
      operation: "create",
      entityId: event.id,
      baseVersion: null,
    });
  });

  it("honors an explicit duration", async () => {
    db = freshDatabase();

    const event = await createEvent(db, {
      title: "Long meeting",
      startAt: START,
      timeZone: "America/New_York",
      durationMinutes: 90,
    });

    expect(event.endAt).toBe("2026-07-20T14:30:00Z");
  });

  it("rejects an empty title without writing anything", async () => {
    db = freshDatabase();

    await expect(
      createEvent(db, { title: "   ", startAt: START, timeZone: "UTC" }),
    ).rejects.toThrow();

    expect(await db.events.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("updateEvent", () => {
  it("coalesces repeated pending edits into one outbox entry with the original base version", async () => {
    db = freshDatabase();
    const event = await createEvent(db, {
      title: "Dentist",
      startAt: START,
      timeZone: "America/New_York",
    });
    // Simulate a server-confirmed version so the update carries a real base.
    await db.events.update(event.id, { version: 4, syncState: "synced" });

    await updateEvent(db, event.id, { title: "Dentist (moved)" });
    await updateEvent(db, event.id, { startAt: "2026-07-20T15:00:00Z" });

    const updates = (await db.outbox.toArray()).filter(
      (entry) => entry.operation === "update",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].baseVersion).toBe(4);
    expect(updates[0].payload.patch).toMatchObject({
      title: "Dentist (moved)",
      startAt: "2026-07-20T15:00:00Z",
    });

    const stored = await db.events.get(event.id);
    expect(stored?.syncState).toBe("pending");
  });
});

describe("event deletion", () => {
  it("hides optimistically, then finalizes with a single idempotent delete", async () => {
    db = freshDatabase();
    const event = await createEvent(db, {
      title: "Dentist",
      startAt: START,
      timeZone: "America/New_York",
    });

    await deleteEventLocally(db, event.id, "2026-07-20T12:00:00Z");
    expect((await db.events.get(event.id))?.deletedAt).toBe(
      "2026-07-20T12:00:00Z",
    );

    await restoreEvent(db, event.id);
    expect((await db.events.get(event.id))?.deletedAt).toBeNull();

    await finalizeEventDeletion(db, event.id);
    expect(await db.events.get(event.id)).toBeUndefined();

    const outbox = await db.outbox.toArray();
    // The superseded create was dropped; only the delete remains.
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ operation: "delete", entity: "event" });
  });
});
