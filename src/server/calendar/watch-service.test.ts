import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { CalendarWebhookConfig } from "./env";
import { createFakeGoogleAdapter } from "./fake-google-adapter";
import type {
  CalendarRepository,
  CalendarSyncRecord,
  ConnectionRecord,
} from "./repository";
import { createTokenCipher } from "./token-cipher";
import { createCalendarWatchService } from "./watch-service";

const NOW = new Date("2026-07-28T12:00:00.000Z");

const CONFIG: CalendarWebhookConfig = {
  address: "https://rails.example/api/calendar/webhook",
  ttlSeconds: 604800,
};

function cipher() {
  return createTokenCipher({
    currentVersion: 1,
    keys: new Map([[1, randomBytes(32)]]),
  });
}

function record(
  overrides: Partial<CalendarSyncRecord> = {},
): CalendarSyncRecord {
  return {
    userId: "user_1",
    googleCalendarId: "primary@example.com",
    summary: "Personal",
    timeZone: "America/New_York",
    isVisible: true,
    syncToken: "cursor-1",
    watchChannelId: null,
    watchResourceId: null,
    watchToken: null,
    watchExpiresAt: null,
    ...overrides,
  };
}

function repository(calendars: CalendarSyncRecord[]) {
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
  const saved: {
    googleCalendarId: string;
    channelId: string;
    resourceId: string;
    token: string;
    expiresAt: Date | null;
  }[] = [];

  const repo = {
    async getConnection() {
      return connection;
    },
    async listVisibleCalendarSyncState() {
      return calendars.map((c) => ({ ...c }));
    },
    async saveWatch(
      _userId: string,
      googleCalendarId: string,
      input: {
        channelId: string;
        resourceId: string;
        token: string;
        expiresAt: Date | null;
      },
    ) {
      saved.push({ googleCalendarId, ...input });
    },
  } as unknown as CalendarRepository;

  return { repo, tokenCipher, saved };
}

function service(calendars: CalendarSyncRecord[]) {
  const { repo, tokenCipher, saved } = repository(calendars);
  const adapter = createFakeGoogleAdapter();
  let seq = 0;
  const watch = createCalendarWatchService({
    calendarRepository: repo,
    adapter,
    cipher: tokenCipher,
    config: CONFIG,
    now: () => NOW,
    newChannelId: () => `chan-${(seq += 1)}`,
    newToken: () => `token-${seq}`,
  });
  return { watch, adapter, saved };
}

describe("ensureWatches", () => {
  it("opens a watch for each visible calendar that has none", async () => {
    const { watch, adapter, saved } = service([
      record({ googleCalendarId: "a@example.com" }),
      record({ googleCalendarId: "b@example.com" }),
    ]);

    const result = await watch.ensureWatches("user_1");

    expect(result).toEqual({ ok: true, registered: 2, skipped: 0 });
    expect(adapter.watchRequests.map((r) => r.calendarId)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    // Every watch is stored with its channel, resource, token, and expiry.
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      googleCalendarId: "a@example.com",
      channelId: "chan-1",
      resourceId: "resource-for-chan-1",
      token: "token-1",
    });
    expect(saved[0].expiresAt).toBeInstanceOf(Date);
    // The webhook address and a TTL are passed to Google.
    expect(adapter.watchRequests[0]).toMatchObject({
      address: CONFIG.address,
      ttlSeconds: CONFIG.ttlSeconds,
    });
  });

  it("skips a calendar whose watch is comfortably in the future", async () => {
    const { watch, adapter } = service([
      record({
        watchChannelId: "existing",
        watchResourceId: "res",
        watchToken: "tok",
        watchExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      }),
    ]);

    const result = await watch.ensureWatches("user_1");

    expect(result).toEqual({ ok: true, registered: 0, skipped: 1 });
    expect(adapter.watchRequests).toHaveLength(0);
  });

  it("renews an expiring watch by stopping the old channel and opening a new one", async () => {
    const { watch, adapter, saved } = service([
      record({
        watchChannelId: "old-channel",
        watchResourceId: "old-resource",
        watchToken: "old-token",
        watchExpiresAt: new Date("2026-07-28T13:00:00.000Z"),
      }),
    ]);

    const result = await watch.ensureWatches("user_1");

    expect(result).toEqual({ ok: true, registered: 1, skipped: 0 });
    expect(adapter.stoppedChannels).toEqual([
      { channelId: "old-channel", resourceId: "old-resource" },
    ]);
    expect(saved[0]).toMatchObject({ channelId: "chan-1" });
  });

  it("reports not_connected when there is no connection", async () => {
    const adapter = createFakeGoogleAdapter();
    const watch = createCalendarWatchService({
      calendarRepository: {
        async getConnection() {
          return null;
        },
      } as unknown as CalendarRepository,
      adapter,
      cipher: cipher(),
      config: CONFIG,
      now: () => NOW,
    });

    expect(await watch.ensureWatches("user_1")).toEqual({
      ok: false,
      reason: "not_connected",
    });
  });

  it("reports unauthorized when the token cannot be refreshed", async () => {
    const { repo, tokenCipher } = repository([record()]);
    const adapter = createFakeGoogleAdapter();
    adapter.refreshAccessToken = async () => {
      throw new Error("invalid_grant");
    };
    const watch = createCalendarWatchService({
      calendarRepository: repo,
      adapter,
      cipher: tokenCipher,
      config: CONFIG,
      now: () => NOW,
    });

    expect(await watch.ensureWatches("user_1")).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(adapter.watchRequests).toHaveLength(0);
  });
});
