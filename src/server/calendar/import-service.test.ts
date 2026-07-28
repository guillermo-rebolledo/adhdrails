import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { SelectedCalendar } from "@/domain/calendar/connection";
import type { GoogleEventResource } from "@/domain/calendar/import";
import type { MirrorEvent } from "@/domain/calendar/import";
import type { EventRepository } from "@/server/event/repository";

import {
  createFakeGoogleAdapter,
  type FakeGoogleAdapterOptions,
} from "./fake-google-adapter";
import { createCalendarImportService } from "./import-service";
import type { CalendarRepository, ConnectionRecord } from "./repository";
import { createTokenCipher } from "./token-cipher";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function cipher() {
  return createTokenCipher({
    currentVersion: 1,
    keys: new Map([[1, randomBytes(32)]]),
  });
}

function calendar(overrides: Partial<SelectedCalendar> = {}): SelectedCalendar {
  return {
    googleCalendarId: "primary@example.com",
    summary: "Personal",
    accessRole: "owner",
    timeZone: "America/New_York",
    primary: true,
    isVisible: true,
    isWritable: true,
    ...overrides,
  };
}

function timedEvent(id: string, hour: number): GoogleEventResource {
  const hh = String(hour).padStart(2, "0");
  return {
    id,
    status: "confirmed",
    summary: `Event ${id}`,
    start: { dateTime: `2026-07-27T${hh}:00:00-04:00` },
    end: { dateTime: `2026-07-27T${hh}:30:00-04:00` },
  };
}

/** A calendar repository stub over in-memory state, recording sync calls. */
function calendarRepository(calendars: SelectedCalendar[]) {
  const tokenCipher = cipher();
  const connection: ConnectionRecord = {
    userId: "user_1",
    status: "connected",
    googleAccountId: "g-1",
    scope: "s",
    encryptedRefreshToken: tokenCipher.encrypt("refresh-token"),
    primaryCalendarId: "primary@example.com",
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
    async listCalendars() {
      return calendars.map((c) => ({ ...c }));
    },
    async recordCalendarSync(
      _userId: string,
      googleCalendarId: string,
      input: { syncToken: string | null; lastSyncedAt: Date },
    ) {
      syncCalls.push({ googleCalendarId, ...input });
    },
    async latestSyncAt() {
      return null;
    },
    async saveConnection() {},
    async replaceSelection() {},
    async deleteConnection() {},
  } as unknown as CalendarRepository;

  return { repository, tokenCipher, connection, syncCalls };
}

/** An event repository stub capturing mirror upserts and removals. */
function eventRepository() {
  const mirror = new Map<string, MirrorEvent>();
  const removed: string[] = [];

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
  } as unknown as EventRepository;

  return { repository, mirror, removed };
}

function service(
  calendars: SelectedCalendar[],
  adapterOptions: FakeGoogleAdapterOptions,
) {
  const cal = calendarRepository(calendars);
  const evt = eventRepository();
  const adapter = createFakeGoogleAdapter({
    grant: {},
    ...adapterOptions,
  });
  const importService = createCalendarImportService({
    calendarRepository: cal.repository,
    eventRepository: evt.repository,
    adapter,
    cipher: cal.tokenCipher,
    now: () => NOW,
  });
  return { importService, adapter, cal, evt };
}

describe("importMirror", () => {
  it("imports mapped events for each visible calendar over the default window", async () => {
    const { importService, adapter, cal, evt } = service([calendar()], {
      events: {
        "primary@example.com": [timedEvent("a", 9), timedEvent("b", 10)],
      },
    });

    const result = await importService.importMirror("user_1");

    expect(result).toMatchObject({ ok: true, imported: 2, removed: 0 });
    expect(evt.mirror.size).toBe(2);
    // The window spans 30 days back through 12 months forward from NOW.
    expect(adapter.eventsRequests[0]).toMatchObject({
      calendarId: "primary@example.com",
      timeMin: "2026-06-27T12:00:00Z",
      timeMax: "2027-07-27T12:00:00Z",
    });
    // Refresh token was decrypted from ciphertext before use.
    expect(adapter.refreshedTokens).toEqual(["refresh-token"]);
    // Each calendar records its cursor and last-synced instant.
    expect(cal.syncCalls).toEqual([
      {
        googleCalendarId: "primary@example.com",
        syncToken: "sync-primary@example.com",
        lastSyncedAt: NOW,
      },
    ]);
  });

  it("pages through a calendar with more events than one page", async () => {
    const { importService, adapter, evt } = service([calendar()], {
      events: {
        "primary@example.com": [
          timedEvent("a", 9),
          timedEvent("b", 10),
          timedEvent("c", 11),
          timedEvent("d", 12),
          timedEvent("e", 13),
        ],
      },
      eventsPageSize: 2,
    });

    const result = await importService.importMirror("user_1");

    expect(result).toMatchObject({ ok: true, imported: 5 });
    expect(evt.mirror.size).toBe(5);
    // 5 events at page size 2 → three reads (2 + 2 + 1).
    expect(adapter.eventsRequests).toHaveLength(3);
  });

  it("removes events Google reports cancelled and skips invisible calendars", async () => {
    const { importService, evt } = service(
      [
        calendar(),
        calendar({
          googleCalendarId: "hidden@example.com",
          isVisible: false,
          primary: false,
        }),
      ],
      {
        events: {
          "primary@example.com": [
            timedEvent("keep", 9),
            { id: "gone", status: "cancelled" },
          ],
          "hidden@example.com": [timedEvent("nope", 9)],
        },
      },
    );

    const result = await importService.importMirror("user_1");

    expect(result).toMatchObject({ ok: true, imported: 1, removed: 1 });
    expect(evt.removed).toContain("primary@example.com:gone");
    expect(evt.mirror.has("hidden@example.com:nope")).toBe(false);
  });

  it("reports not_connected when no connection exists", async () => {
    const cal = calendarRepository([calendar()]);
    const evt = eventRepository();
    const importService = createCalendarImportService({
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

    expect(await importService.importMirror("user_1")).toEqual({
      ok: false,
      reason: "not_connected",
    });
  });

  it("reports unauthorized when the access token cannot be refreshed", async () => {
    const cal = calendarRepository([calendar()]);
    const evt = eventRepository();
    const adapter = createFakeGoogleAdapter();
    adapter.refreshAccessToken = async () => {
      throw new Error("invalid_grant");
    };
    const importService = createCalendarImportService({
      calendarRepository: cal.repository,
      eventRepository: evt.repository,
      adapter,
      cipher: cal.tokenCipher,
      now: () => NOW,
    });

    expect(await importService.importMirror("user_1")).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(evt.mirror.size).toBe(0);
  });
});
