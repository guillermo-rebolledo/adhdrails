import "fake-indexeddb/auto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventResponse } from "@/domain/event/event";

import { RailsDatabase } from "./db";
import type { LocalEvent } from "./db";
import {
  fetchEventWindow,
  reconcileEventWindow,
  syncCalendarMirror,
} from "./event-pull";

function freshDatabase(): RailsDatabase {
  return new RailsDatabase(`test-${crypto.randomUUID()}`);
}

const WINDOW = {
  from: "2026-07-27T00:00:00.000Z",
  to: "2026-08-03T00:00:00.000Z",
};

function serverEvent(
  id: string,
  overrides: Partial<EventResponse> = {},
): EventResponse {
  return {
    id,
    title: "Standup",
    startAt: "2026-07-28T13:00:00.000Z",
    endAt: "2026-07-28T13:30:00.000Z",
    startTimeZone: "America/New_York",
    endTimeZone: "America/New_York",
    isAllDay: false,
    allDayStartDate: null,
    allDayEndDate: null,
    recurringEventId: null,
    recurrence: null,
    status: "confirmed",
    origin: "google",
    version: 1,
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

function localEvent(overrides: Partial<LocalEvent> = {}): LocalEvent {
  return {
    id: crypto.randomUUID(),
    title: "Local",
    startAt: "2026-07-28T15:00:00.000Z",
    endAt: "2026-07-28T15:30:00.000Z",
    startTimeZone: "America/New_York",
    endTimeZone: "America/New_York",
    isAllDay: false,
    recurringEventId: null,
    status: "confirmed",
    origin: "local",
    version: 1,
    createdAt: "2026-07-20T10:00:00.000Z",
    deletedAt: null,
    syncState: "synced",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reconcileEventWindow", () => {
  it("inserts imported Google Events as synced", async () => {
    const db = freshDatabase();
    await reconcileEventWindow(
      db,
      [serverEvent("g-1"), serverEvent("g-2", { isAllDay: true })],
      WINDOW,
    );

    const rows = await db.events.toArray();
    expect(rows).toHaveLength(2);
    expect(rows.every((e) => e.origin === "google")).toBe(true);
    expect(rows.every((e) => e.syncState === "synced")).toBe(true);
  });

  it("does not clobber a pending local change", async () => {
    const db = freshDatabase();
    await db.events.put(
      localEvent({ id: "g-1", title: "My edit", syncState: "pending" }),
    );

    await reconcileEventWindow(
      db,
      [serverEvent("g-1", { title: "Server" })],
      WINDOW,
    );

    const row = await db.events.get("g-1");
    expect(row?.title).toBe("My edit");
    expect(row?.syncState).toBe("pending");
  });

  it("preserves an optimistic deletion mid-undo", async () => {
    const db = freshDatabase();
    await db.events.put(
      localEvent({
        id: "g-1",
        deletedAt: "2026-07-27T12:00:00.000Z",
        syncState: "synced",
      }),
    );

    await reconcileEventWindow(db, [serverEvent("g-1")], WINDOW);

    const row = await db.events.get("g-1");
    expect(row?.deletedAt).toBe("2026-07-27T12:00:00.000Z");
  });

  it("removes a Google Event the server no longer returns in the window", async () => {
    const db = freshDatabase();
    await db.events.put(localEvent({ id: "g-gone", origin: "google" }));

    await reconcileEventWindow(db, [], WINDOW);

    expect(await db.events.get("g-gone")).toBeUndefined();
  });

  it("leaves a local Event untouched when it is absent from the server window", async () => {
    const db = freshDatabase();
    await db.events.put(localEvent({ id: "local-1", origin: "local" }));

    await reconcileEventWindow(db, [], WINDOW);

    expect(await db.events.get("local-1")).toBeDefined();
  });
});

describe("fetchEventWindow", () => {
  it("fetches the window and reconciles it into Dexie", async () => {
    const db = freshDatabase();
    const id = crypto.randomUUID();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [serverEvent(id)] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const ids = await fetchEventWindow(db, WINDOW);

    expect(ids).toEqual([id]);
    expect(await db.events.get(id)).toBeDefined();
  });
});

describe("syncCalendarMirror", () => {
  it("returns the sync result on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            imported: 4,
            removed: 0,
            lastSyncedAt: "2026-07-27T12:00:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    expect(await syncCalendarMirror()).toEqual({
      imported: 4,
      removed: 0,
      lastSyncedAt: "2026-07-27T12:00:00.000Z",
    });
  });

  it("returns null when Calendar is not connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ code: "not_found" }), { status: 404 }),
        ),
    );

    expect(await syncCalendarMirror()).toBeNull();
  });
});
