import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { SelectedCalendar } from "@/domain/calendar/connection";

import { createFakeGoogleAdapter } from "./fake-google-adapter";
import type {
  CalendarRepository,
  ConnectionRecord,
  SaveConnectionInput,
} from "./repository";
import { createCalendarService } from "./service";
import { createTokenCipher } from "./token-cipher";

/** A minimal in-memory stand-in for the account-scoped Calendar repository. */
function inMemoryRepository() {
  const connections = new Map<string, ConnectionRecord>();
  const calendars = new Map<string, SelectedCalendar[]>();
  const syncState = new Map<string, Map<string, Date>>();

  const repository: CalendarRepository = {
    async getConnection(userId) {
      return connections.get(userId) ?? null;
    },
    async listCalendars(userId) {
      return (calendars.get(userId) ?? []).map((c) => ({ ...c }));
    },
    async saveConnection(userId, input: SaveConnectionInput) {
      connections.set(userId, {
        userId,
        status: input.status,
        googleAccountId: input.googleAccountId,
        scope: input.scope,
        encryptedRefreshToken: input.encryptedRefreshToken,
        primaryCalendarId: input.primaryCalendarId,
        primaryTimeZone: input.primaryTimeZone,
        connectedAt: new Date("2026-07-27T12:00:00.000Z"),
      });
      calendars.set(userId, input.calendars);
    },
    async replaceSelection(userId, selections) {
      const current = calendars.get(userId) ?? [];
      calendars.set(
        userId,
        current.map((calendar) => {
          const match = selections.find(
            (s) => s.googleCalendarId === calendar.googleCalendarId,
          );
          return match
            ? {
                ...calendar,
                isVisible: match.isVisible,
                isWritable: match.isWritable,
              }
            : calendar;
        }),
      );
    },
    async recordCalendarSync(userId, googleCalendarId, input) {
      const forUser = syncState.get(userId) ?? new Map<string, Date>();
      forUser.set(googleCalendarId, input.lastSyncedAt);
      syncState.set(userId, forUser);
    },
    async latestSyncAt(userId) {
      const forUser = syncState.get(userId);
      if (!forUser || forUser.size === 0) {
        return null;
      }
      return [...forUser.values()].reduce((a, b) => (a > b ? a : b));
    },
    async getCalendar() {
      return null;
    },
    async getCalendarByChannel() {
      return null;
    },
    async listVisibleCalendarSyncState() {
      return [];
    },
    async saveWatch() {},
    async deleteConnection(userId) {
      connections.delete(userId);
      calendars.delete(userId);
      syncState.delete(userId);
    },
  };

  return { repository, connections, calendars };
}

function cipher() {
  return createTokenCipher({
    currentVersion: 1,
    keys: new Map([[1, randomBytes(32)]]),
  });
}

describe("completeAuthorization", () => {
  it("stores the refresh token only as ciphertext, never plaintext", async () => {
    const { repository, connections } = inMemoryRepository();
    const adapter = createFakeGoogleAdapter();
    const tokenCipher = cipher();
    const service = createCalendarService({
      repository,
      adapter,
      cipher: tokenCipher,
    });

    const result = await service.completeAuthorization("user_1", "auth-code");

    expect(result).toEqual({ ok: true });
    const stored = connections.get("user_1")!;
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain("refresh-for-auth-code");
    // The ciphertext must decrypt back to the real token.
    expect(tokenCipher.decrypt(stored.encryptedRefreshToken)).toBe(
      "refresh-for-auth-code",
    );
    expect(stored.status).toBe("connected");
  });

  it("defaults the primary calendar writable and records its timezone", async () => {
    const { repository } = inMemoryRepository();
    const service = createCalendarService({
      repository,
      adapter: createFakeGoogleAdapter(),
      cipher: cipher(),
    });

    await service.completeAuthorization("user_1", "code");
    const connection = await service.getConnection("user_1");

    expect(connection?.primaryTimeZone).toBe("America/New_York");
    const primary = connection?.calendars.find((c) => c.primary);
    expect(primary?.isWritable).toBe(true);
    expect(connection?.calendars.every((c) => c.isVisible)).toBe(true);
  });

  it("persists no connection when the code exchange fails", async () => {
    const { repository, connections } = inMemoryRepository();
    const service = createCalendarService({
      repository,
      adapter: createFakeGoogleAdapter({
        exchangeError: new Error("boom"),
      }),
      cipher: cipher(),
    });

    const result = await service.completeAuthorization("user_1", "code");

    expect(result).toEqual({ ok: false, reason: "exchange_failed" });
    expect(connections.has("user_1")).toBe(false);
  });
});

describe("getConnection", () => {
  it("returns null when Calendar is not connected", async () => {
    const { repository } = inMemoryRepository();
    const service = createCalendarService({
      repository,
      adapter: createFakeGoogleAdapter(),
      cipher: cipher(),
    });

    expect(await service.getConnection("user_1")).toBeNull();
  });
});

describe("saveSelection", () => {
  async function connectedService() {
    const { repository } = inMemoryRepository();
    const service = createCalendarService({
      repository,
      adapter: createFakeGoogleAdapter(),
      cipher: cipher(),
    });
    await service.completeAuthorization("user_1", "code");
    return service;
  }

  it("rejects promoting a read-only calendar to writable", async () => {
    const service = await connectedService();

    const result = await service.saveSelection("user_1", {
      selections: [
        {
          googleCalendarId: "holidays@group.v.calendar.google.com",
          isVisible: true,
          isWritable: true,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      validation: { reason: "readonly_writable" },
    });
  });

  it("rejects two writable calendars", async () => {
    const service = await connectedService();

    const result = await service.saveSelection("user_1", {
      selections: [
        {
          googleCalendarId: "primary@example.com",
          isVisible: true,
          isWritable: true,
        },
        {
          googleCalendarId: "team@group.calendar.google.com",
          isVisible: true,
          isWritable: true,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      validation: { reason: "multiple_writable" },
    });
  });

  it("moves the writable calendar and toggles visibility", async () => {
    const service = await connectedService();

    const result = await service.saveSelection("user_1", {
      selections: [
        {
          googleCalendarId: "primary@example.com",
          isVisible: true,
          isWritable: false,
        },
        {
          googleCalendarId: "team@group.calendar.google.com",
          isVisible: true,
          isWritable: true,
        },
        {
          googleCalendarId: "holidays@group.v.calendar.google.com",
          isVisible: false,
          isWritable: false,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const writable = result.calendars.filter((c) => c.isWritable);
    expect(writable).toHaveLength(1);
    expect(writable[0].googleCalendarId).toBe("team@group.calendar.google.com");
    expect(
      result.calendars.find(
        (c) => c.googleCalendarId === "holidays@group.v.calendar.google.com",
      )?.isVisible,
    ).toBe(false);
  });

  it("reports not_connected when there is no connection", async () => {
    const { repository } = inMemoryRepository();
    const service = createCalendarService({
      repository,
      adapter: createFakeGoogleAdapter(),
      cipher: cipher(),
    });

    const result = await service.saveSelection("user_1", { selections: [] });
    expect(result).toEqual({ ok: false, reason: "not_connected" });
  });
});

describe("disconnect", () => {
  it("revokes the grant with the decrypted token and deletes the connection", async () => {
    const { repository, connections } = inMemoryRepository();
    const adapter = createFakeGoogleAdapter();
    const service = createCalendarService({
      repository,
      adapter,
      cipher: cipher(),
    });
    await service.completeAuthorization("user_1", "abc");

    const result = await service.disconnect("user_1");

    expect(result).toEqual({ wasConnected: true });
    expect(adapter.revokedTokens).toEqual(["refresh-for-abc"]);
    expect(connections.has("user_1")).toBe(false);
  });

  it("is a no-op that reports wasConnected false when nothing is connected", async () => {
    const { repository } = inMemoryRepository();
    const adapter = createFakeGoogleAdapter();
    const service = createCalendarService({
      repository,
      adapter,
      cipher: cipher(),
    });

    expect(await service.disconnect("user_1")).toEqual({
      wasConnected: false,
    });
    expect(adapter.revokedTokens).toEqual([]);
  });
});
