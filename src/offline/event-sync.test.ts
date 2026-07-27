import "fake-indexeddb/auto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventResponse } from "@/domain/event/event";

import { RailsDatabase } from "./db";
import {
  createEvent,
  finalizeEventDeletion,
  updateEvent,
} from "./event-commands";
import { drainOutbox, type SendResult } from "./sync";

function freshDatabase(): RailsDatabase {
  return new RailsDatabase(`test-${crypto.randomUUID()}`);
}

function serverEvent(
  id: string,
  overrides: Partial<EventResponse> = {},
): EventResponse {
  return {
    id,
    title: "Dentist",
    startAt: "2026-07-20T13:00:00.000Z",
    endAt: "2026-07-20T13:30:00.000Z",
    startTimeZone: "America/New_York",
    endTimeZone: "America/New_York",
    isAllDay: false,
    allDayStartDate: null,
    allDayEndDate: null,
    recurringEventId: null,
    recurrence: null,
    status: "confirmed",
    origin: "local",
    version: 1,
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

const START = "2026-07-20T13:00:00Z";

describe("drainOutbox for events", () => {
  it("reconciles a confirmed create and marks the event synced", async () => {
    db = freshDatabase();
    const event = await createEvent(db, {
      title: "Dentist",
      startAt: START,
      timeZone: "America/New_York",
    });
    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({ ok: true, item: serverEvent(event.id, { version: 2 }) }),
    );

    await drainOutbox({ db, send });

    expect(await db.events.get(event.id)).toMatchObject({
      syncState: "synced",
      version: 2,
    });
    expect(await db.outbox.count()).toBe(0);
  });

  it("removes the local row after a confirmed delete", async () => {
    db = freshDatabase();
    const event = await createEvent(db, {
      title: "Gone soon",
      startAt: START,
      timeZone: "UTC",
    });
    await db.events.update(event.id, { syncState: "synced" });
    await db.outbox.clear();
    await finalizeEventDeletion(db, event.id);

    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({ ok: true }),
    );

    await drainOutbox({ db, send });

    expect(await db.events.get(event.id)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it("retains a conflicted update for review", async () => {
    db = freshDatabase();
    const event = await createEvent(db, {
      title: "Local edit",
      startAt: START,
      timeZone: "UTC",
    });
    await db.events.update(event.id, { syncState: "synced", version: 1 });
    await db.outbox.clear();
    await updateEvent(db, event.id, { title: "Renamed locally" });

    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({
        ok: false,
        kind: "conflict",
        current: serverEvent(event.id, { title: "Server edit", version: 9 }),
      }),
    );

    await drainOutbox({ db, send });

    expect(await db.events.get(event.id)).toMatchObject({
      syncState: "conflict",
      title: "Renamed locally",
    });
    expect((await db.outbox.toArray())[0]).toMatchObject({
      status: "failed",
      lastError: "conflict",
    });
  });

  it("drops a queued mutation for a tombstoned event rather than resurrecting it", async () => {
    db = freshDatabase();
    const event = await createEvent(db, {
      title: "Deleted elsewhere",
      startAt: START,
      timeZone: "UTC",
    });
    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({ ok: false, kind: "gone" }),
    );

    await drainOutbox({ db, send });

    expect(await db.events.get(event.id)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
});
