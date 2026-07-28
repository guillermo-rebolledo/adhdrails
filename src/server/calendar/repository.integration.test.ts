import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { SelectedCalendar } from "@/domain/calendar/connection";
import { createDatabaseConnection } from "@/server/db/client";
import {
  calendarConnection,
  calendarSelection,
  user,
} from "@/server/db/schema";

import { createCalendarRepository } from "./repository";
import type { EncryptedToken } from "./token-cipher";

const DATABASE_URL = process.env.DATABASE_URL;
const USER_IDS = ["cal-owner", "cal-neighbor"];

const connection = DATABASE_URL
  ? createDatabaseConnection(DATABASE_URL)
  : undefined;

const token: EncryptedToken = {
  ciphertext: "Y2lwaGVy",
  nonce: "bm9uY2U=",
  authTag: "dGFn",
  keyVersion: 1,
};

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

describe.skipIf(!connection)(
  "Calendar repository PostgreSQL integration",
  () => {
    const repository = () => createCalendarRepository(connection!.database);

    beforeEach(async () => {
      await connection!.database.delete(user).where(inArray(user.id, USER_IDS));
      await connection!.database
        .insert(user)
        .values(
          USER_IDS.map((id) => ({ id, name: id, email: `${id}@example.test` })),
        );
    });

    afterAll(async () => {
      await connection!.database.delete(user).where(inArray(user.id, USER_IDS));
      await connection!.close();
    });

    it("persists a connection with only encrypted token fields and reads it back", async () => {
      await repository().saveConnection(USER_IDS[0], {
        status: "connected",
        googleAccountId: "g-1",
        scope: "calendar.readonly",
        encryptedRefreshToken: token,
        primaryCalendarId: "primary@example.com",
        primaryTimeZone: "America/New_York",
        calendars: [calendar()],
      });

      const record = await repository().getConnection(USER_IDS[0]);
      expect(record?.encryptedRefreshToken).toEqual(token);
      expect(record?.status).toBe("connected");

      const calendars = await repository().listCalendars(USER_IDS[0]);
      expect(calendars).toHaveLength(1);
      expect(calendars[0].isWritable).toBe(true);
    });

    it("scopes reads to the owning account", async () => {
      await repository().saveConnection(USER_IDS[0], {
        status: "connected",
        googleAccountId: null,
        scope: "s",
        encryptedRefreshToken: token,
        primaryCalendarId: null,
        primaryTimeZone: null,
        calendars: [calendar()],
      });

      expect(await repository().getConnection(USER_IDS[1])).toBeNull();
      expect(await repository().listCalendars(USER_IDS[1])).toEqual([]);
    });

    it("enforces at most one writable calendar as the target moves", async () => {
      await repository().saveConnection(USER_IDS[0], {
        status: "connected",
        googleAccountId: null,
        scope: "s",
        encryptedRefreshToken: token,
        primaryCalendarId: "primary@example.com",
        primaryTimeZone: null,
        calendars: [
          calendar({ googleCalendarId: "a", isWritable: true, primary: true }),
          calendar({
            googleCalendarId: "b",
            accessRole: "writer",
            isWritable: false,
            primary: false,
          }),
        ],
      });

      // Move the writable target from a to b — must not trip the partial unique.
      await repository().replaceSelection(USER_IDS[0], [
        { googleCalendarId: "a", isVisible: true, isWritable: false },
        { googleCalendarId: "b", isVisible: true, isWritable: true },
      ]);

      const calendars = await repository().listCalendars(USER_IDS[0]);
      const writable = calendars.filter((c) => c.isWritable);
      expect(writable).toHaveLength(1);
      expect(writable[0].googleCalendarId).toBe("b");
    });

    it("stores a per-calendar watch and resolves it back by channel id", async () => {
      await repository().saveConnection(USER_IDS[0], {
        status: "connected",
        googleAccountId: null,
        scope: "s",
        encryptedRefreshToken: token,
        primaryCalendarId: "primary@example.com",
        primaryTimeZone: null,
        calendars: [calendar()],
      });

      const expiresAt = new Date("2026-08-04T12:00:00.000Z");
      await repository().saveWatch(USER_IDS[0], "primary@example.com", {
        channelId: "chan-xyz",
        resourceId: "res-xyz",
        token: "watch-token",
        expiresAt,
      });

      // The webhook resolves an incoming channel to its owning calendar.
      const byChannel = await repository().getCalendarByChannel("chan-xyz");
      expect(byChannel).toMatchObject({
        userId: USER_IDS[0],
        googleCalendarId: "primary@example.com",
        watchToken: "watch-token",
        watchResourceId: "res-xyz",
      });
      expect(byChannel?.watchExpiresAt?.toISOString()).toBe(
        expiresAt.toISOString(),
      );

      // An unknown channel resolves to nothing.
      expect(await repository().getCalendarByChannel("missing")).toBeNull();

      // Renewal replaces the channel: the old id no longer routes, the new does.
      await repository().saveWatch(USER_IDS[0], "primary@example.com", {
        channelId: "chan-renewed",
        resourceId: "res-renewed",
        token: "watch-token-2",
        expiresAt,
      });
      expect(await repository().getCalendarByChannel("chan-xyz")).toBeNull();
      expect(
        (await repository().getCalendarByChannel("chan-renewed"))?.watchToken,
      ).toBe("watch-token-2");
    });

    it("lists only the account's visible calendars for a renewal sweep", async () => {
      await repository().saveConnection(USER_IDS[0], {
        status: "connected",
        googleAccountId: null,
        scope: "s",
        encryptedRefreshToken: token,
        primaryCalendarId: "a",
        primaryTimeZone: null,
        calendars: [
          calendar({ googleCalendarId: "a", isVisible: true, primary: true }),
          calendar({
            googleCalendarId: "b",
            isVisible: false,
            isWritable: false,
            primary: false,
          }),
        ],
      });

      const visible = await repository().listVisibleCalendarSyncState(
        USER_IDS[0],
      );
      expect(visible.map((c) => c.googleCalendarId)).toEqual(["a"]);
      // Another account sees none of these.
      expect(
        await repository().listVisibleCalendarSyncState(USER_IDS[1]),
      ).toEqual([]);
    });

    it("lists the ids of every connected account for a maintenance sweep", async () => {
      for (const id of USER_IDS) {
        await repository().saveConnection(id, {
          status: "connected",
          googleAccountId: null,
          scope: "s",
          encryptedRefreshToken: token,
          primaryCalendarId: null,
          primaryTimeZone: null,
          calendars: [calendar()],
        });
      }

      expect(await repository().listConnectedUserIds()).toEqual(
        [...USER_IDS].sort(),
      );
    });

    it("lists only stale or never-synced visible calendars as due for reconciliation", async () => {
      await repository().saveConnection(USER_IDS[0], {
        status: "connected",
        googleAccountId: null,
        scope: "s",
        encryptedRefreshToken: token,
        primaryCalendarId: "recent",
        primaryTimeZone: null,
        calendars: [
          calendar({ googleCalendarId: "recent", primary: true }),
          calendar({
            googleCalendarId: "stale",
            isWritable: false,
            primary: false,
          }),
          calendar({
            googleCalendarId: "never",
            isWritable: false,
            primary: false,
          }),
          calendar({
            googleCalendarId: "hidden",
            isVisible: false,
            isWritable: false,
            primary: false,
          }),
        ],
      });

      const cutoff = new Date("2026-07-28T12:00:00.000Z");
      // "recent" synced after the cutoff; "stale" and "hidden" well before it.
      await repository().recordCalendarSync(USER_IDS[0], "recent", {
        syncToken: "t",
        lastSyncedAt: new Date("2026-07-28T12:30:00.000Z"),
      });
      await repository().recordCalendarSync(USER_IDS[0], "stale", {
        syncToken: "t",
        lastSyncedAt: new Date("2026-07-20T00:00:00.000Z"),
      });
      await repository().recordCalendarSync(USER_IDS[0], "hidden", {
        syncToken: "t",
        lastSyncedAt: new Date("2026-07-20T00:00:00.000Z"),
      });

      const due = await repository().listCalendarsDueForReconciliation(cutoff);

      // Never-synced and stale visible calendars are due; recent and hidden are not.
      expect(due).toEqual([
        { userId: USER_IDS[0], googleCalendarId: "never" },
        { userId: USER_IDS[0], googleCalendarId: "stale" },
      ]);
    });

    it("deletes the connection and its calendars without touching the user", async () => {
      await repository().saveConnection(USER_IDS[0], {
        status: "connected",
        googleAccountId: null,
        scope: "s",
        encryptedRefreshToken: token,
        primaryCalendarId: null,
        primaryTimeZone: null,
        calendars: [calendar()],
      });

      await repository().deleteConnection(USER_IDS[0]);

      expect(await repository().getConnection(USER_IDS[0])).toBeNull();
      const [remaining] = await connection!.database
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, USER_IDS[0]));
      expect(remaining?.id).toBe(USER_IDS[0]);

      const orphanConnections = await connection!.database
        .select()
        .from(calendarConnection)
        .where(eq(calendarConnection.userId, USER_IDS[0]));
      const orphanCalendars = await connection!.database
        .select()
        .from(calendarSelection)
        .where(eq(calendarSelection.userId, USER_IDS[0]));
      expect(orphanConnections).toEqual([]);
      expect(orphanCalendars).toEqual([]);
    });
  },
);
