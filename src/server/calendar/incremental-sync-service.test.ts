import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { GoogleEventResource } from "@/domain/calendar/import";
import type { MirrorEvent } from "@/domain/calendar/import";
import type { EventRepository } from "@/server/event/repository";

import {
  createFakeGoogleAdapter,
  type FakeGoogleAdapterOptions,
} from "./fake-google-adapter";
import { createIncrementalSyncService } from "./incremental-sync-service";
import type {
  CalendarRepository,
  CalendarSyncRecord,
  ConnectionRecord,
} from "./repository";
import { createTokenCipher } from "./token-cipher";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const CAL = "primary@example.com";

function cipher() {
  return createTokenCipher({
    currentVersion: 1,
    keys: new Map([[1, randomBytes(32)]]),
  });
}

function timedEvent(id: string, hour: number): GoogleEventResource {
  const hh = String(hour).padStart(2, "0");
  return {
    id,
    status: "confirmed",
    summary: `Event ${id}`,
    start: { dateTime: `2026-07-28T${hh}:00:00-04:00` },
    end: { dateTime: `2026-07-28T${hh}:30:00-04:00` },
  };
}

function calendarRepository(calendar: CalendarSyncRecord | null) {
  const tokenCipher = cipher();
  const connection: ConnectionRecord = {
    userId: "user_1",
    status: "connected",
    googleAccountId: "g-1",
    scope: "s",
    encryptedRefreshToken: tokenCipher.encrypt("refresh-token"),
    primaryCalendarId: CAL,
    primaryTimeZone: "America/New_York",
    connectedAt: NOW,
  };
  const syncCalls: {
    googleCalendarId: string;
    syncToken: string | null;
    lastSyncedAt: Date;
  }[] = [];

  const repository = {
    async getConnection() {
      return connection;
    },
    async getCalendar() {
      return calendar;
    },
    async recordCalendarSync(
      _userId: string,
      googleCalendarId: string,
      input: { syncToken: string | null; lastSyncedAt: Date },
    ) {
      syncCalls.push({ googleCalendarId, ...input });
    },
  } as unknown as CalendarRepository;

  return { repository, tokenCipher, syncCalls };
}

function eventRepository() {
  const mirror = new Map<string, MirrorEvent>();
  const removed: string[] = [];
  const clearedCalendars: string[] = [];

  const repository = {
    async upsertMirror(_userId: string, event: MirrorEvent) {
      mirror.set(`${event.googleCalendarId}:${event.googleEventId}`, event);
    },
    async removeMirror(
      _userId: string,
      googleCalendarId: string,
      googleEventId: string,
    ) {
      const key = `${googleCalendarId}:${googleEventId}`;
      mirror.delete(key);
      removed.push(key);
    },
    async removeMirrorForCalendar(_userId: string, googleCalendarId: string) {
      clearedCalendars.push(googleCalendarId);
      for (const key of [...mirror.keys()]) {
        if (key.startsWith(`${googleCalendarId}:`)) {
          mirror.delete(key);
        }
      }
    },
  } as unknown as EventRepository;

  return { repository, mirror, removed, clearedCalendars };
}

function syncRecord(
  overrides: Partial<CalendarSyncRecord> = {},
): CalendarSyncRecord {
  return {
    userId: "user_1",
    googleCalendarId: CAL,
    summary: "Personal",
    timeZone: "America/New_York",
    isVisible: true,
    syncToken: "cursor-1",
    watchChannelId: "chan-1",
    watchResourceId: "res-1",
    watchToken: "tok-1",
    watchExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function service(
  calendar: CalendarSyncRecord | null,
  adapterOptions: FakeGoogleAdapterOptions = {},
) {
  const cal = calendarRepository(calendar);
  const evt = eventRepository();
  const adapter = createFakeGoogleAdapter(adapterOptions);
  const syncService = createIncrementalSyncService({
    calendarRepository: cal.repository,
    eventRepository: evt.repository,
    adapter,
    cipher: cal.tokenCipher,
    now: () => NOW,
  });
  return { syncService, adapter, cal, evt };
}

describe("syncCalendar", () => {
  it("applies changes from the stored cursor and advances the cursor", async () => {
    const { syncService, adapter, cal, evt } = service(syncRecord(), {
      changes: { [CAL]: [timedEvent("a", 9), timedEvent("b", 10)] },
    });

    const result = await syncService.syncCalendar("user_1", CAL);

    expect(result).toMatchObject({
      ok: true,
      changed: 2,
      removed: 0,
      recovered: false,
    });
    expect(evt.mirror.size).toBe(2);
    // The incremental read resumed from the stored cursor, never the window.
    expect(adapter.changesRequests[0]).toMatchObject({
      calendarId: CAL,
      syncToken: "cursor-1",
    });
    expect(adapter.eventsRequests).toHaveLength(0);
    expect(cal.syncCalls).toEqual([
      {
        googleCalendarId: CAL,
        syncToken: `sync-next-${CAL}`,
        lastSyncedAt: NOW,
      },
    ]);
  });

  it("pages through more changes than fit in one page", async () => {
    const { syncService, adapter, evt } = service(syncRecord(), {
      changes: {
        [CAL]: [
          timedEvent("a", 9),
          timedEvent("b", 10),
          timedEvent("c", 11),
          timedEvent("d", 12),
          timedEvent("e", 13),
        ],
      },
      eventsPageSize: 2,
    });

    const result = await syncService.syncCalendar("user_1", CAL);

    expect(result).toMatchObject({ ok: true, changed: 5 });
    expect(evt.mirror.size).toBe(5);
    expect(adapter.changesRequests).toHaveLength(3);
  });

  it("removes an event Google reports cancelled without duplicating", async () => {
    const { syncService, evt } = service(syncRecord(), {
      changes: {
        [CAL]: [timedEvent("keep", 9), { id: "gone", status: "cancelled" }],
      },
    });

    const result = await syncService.syncCalendar("user_1", CAL);

    expect(result).toMatchObject({ ok: true, changed: 1, removed: 1 });
    expect(evt.removed).toContain(`${CAL}:gone`);
    expect(evt.mirror.has(`${CAL}:keep`)).toBe(true);
  });

  it("does a bounded window resync when the calendar has no cursor yet", async () => {
    const { syncService, adapter, cal } = service(
      syncRecord({ syncToken: null }),
      { events: { [CAL]: [timedEvent("a", 9)] } },
    );

    const result = await syncService.syncCalendar("user_1", CAL);

    expect(result).toMatchObject({ ok: true, changed: 1, recovered: false });
    // A cursorless calendar reads the window, not the change feed Google rejects.
    expect(adapter.eventsRequests).toHaveLength(1);
    expect(adapter.changesRequests).toHaveLength(0);
    expect(cal.syncCalls[0].syncToken).toBe(`sync-${CAL}`);
  });

  it("recovers from a 410 by clearing the calendar mirror and resyncing the window", async () => {
    const { syncService, adapter, cal, evt } = service(syncRecord(), {
      changesGone: [CAL],
      events: { [CAL]: [timedEvent("rebuilt", 9)] },
    });

    const result = await syncService.syncCalendar("user_1", CAL);

    expect(result).toMatchObject({ ok: true, recovered: true, changed: 1 });
    // The affected calendar's mirror was cleared before the bounded resync.
    expect(evt.clearedCalendars).toEqual([CAL]);
    expect(adapter.eventsRequests).toHaveLength(1);
    // The cursor is cleared first, then re-recorded from the window read.
    expect(cal.syncCalls[0]).toMatchObject({ syncToken: null });
    expect(cal.syncCalls.at(-1)).toMatchObject({ syncToken: `sync-${CAL}` });
  });

  it("never restores the expired cursor after a 410, even if the resync yields none", async () => {
    const { syncService, cal } = service(syncRecord(), {
      changesGone: [CAL],
      events: { [CAL]: [timedEvent("rebuilt", 9)] },
      // The bounded resync returns no fresh sync token.
      syncTokenFor: () => "",
    });

    await syncService.syncCalendar("user_1", CAL);

    // The final recorded cursor is null, not the stale token that caused the 410.
    expect(cal.syncCalls.at(-1)).toMatchObject({ syncToken: null });
  });

  it("keeps the prior cursor when a change page carries no new sync token", async () => {
    const { syncService, cal } = service(syncRecord(), {
      changes: { [CAL]: [timedEvent("a", 9)] },
      nextSyncTokenFor: () => "",
    });

    await syncService.syncCalendar("user_1", CAL);

    expect(cal.syncCalls[0].syncToken).toBe("cursor-1");
  });

  it("reports not_connected when there is no connection", async () => {
    const cal = calendarRepository(syncRecord());
    const evt = eventRepository();
    const syncService = createIncrementalSyncService({
      calendarRepository: {
        ...cal.repository,
        async getConnection() {
          return null;
        },
      } as unknown as CalendarRepository,
      eventRepository: evt.repository,
      adapter: createFakeGoogleAdapter(),
      cipher: cal.tokenCipher,
      now: () => NOW,
    });

    expect(await syncService.syncCalendar("user_1", CAL)).toEqual({
      ok: false,
      reason: "not_connected",
    });
  });

  it("reports calendar_not_found when the calendar is missing or hidden", async () => {
    expect(await service(null).syncService.syncCalendar("user_1", CAL)).toEqual(
      { ok: false, reason: "calendar_not_found" },
    );

    expect(
      await service(syncRecord({ isVisible: false })).syncService.syncCalendar(
        "user_1",
        CAL,
      ),
    ).toEqual({ ok: false, reason: "calendar_not_found" });
  });

  it("reports unauthorized when the access token cannot be refreshed", async () => {
    const cal = calendarRepository(syncRecord());
    const evt = eventRepository();
    const adapter = createFakeGoogleAdapter();
    adapter.refreshAccessToken = async () => {
      throw new Error("invalid_grant");
    };
    const syncService = createIncrementalSyncService({
      calendarRepository: cal.repository,
      eventRepository: evt.repository,
      adapter,
      cipher: cal.tokenCipher,
      now: () => NOW,
    });

    expect(await syncService.syncCalendar("user_1", CAL)).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(evt.mirror.size).toBe(0);
  });
});
