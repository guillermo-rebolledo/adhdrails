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
