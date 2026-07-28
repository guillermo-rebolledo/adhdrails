import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { MirrorEvent } from "@/domain/calendar/import";
import { createDatabaseConnection } from "@/server/db/client";
import { event, user } from "@/server/db/schema";

import { createEventRepository } from "./repository";

const DATABASE_URL = process.env.DATABASE_URL;
const USER_IDS = ["evt-owner", "evt-neighbor"];

const connection = DATABASE_URL
  ? createDatabaseConnection(DATABASE_URL)
  : undefined;

function mirror(overrides: Partial<MirrorEvent> = {}): MirrorEvent {
  return {
    googleCalendarId: "primary@example.com",
    googleEventId: "g-evt-1",
    title: "Standup",
    startAt: "2026-07-27T13:00:00.000Z",
    endAt: "2026-07-27T13:30:00.000Z",
    startTimeZone: "America/New_York",
    endTimeZone: "America/New_York",
    isAllDay: false,
    allDayStartDate: null,
    allDayEndDate: null,
    recurringEventId: null,
    recurrence: null,
    status: "confirmed",
    ...overrides,
  };
}

describe.skipIf(!connection)(
  "Event mirror repository PostgreSQL integration",
  () => {
    const repository = () => createEventRepository(connection!.database);

    async function mirrorRows(userId: string) {
      return connection!.database
        .select()
        .from(event)
        .where(eq(event.userId, userId));
    }

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

    it("inserts a mirror row marked as a Google event", async () => {
      await repository().upsertMirror(USER_IDS[0], mirror());

      const rows = await mirrorRows(USER_IDS[0]);
      expect(rows).toHaveLength(1);
      expect(rows[0].origin).toBe("google");
      expect(rows[0].googleEventId).toBe("g-evt-1");
      expect(rows[0].title).toBe("Standup");
    });

    it("upserts idempotently: a re-delivered event updates in place, never duplicates", async () => {
      await repository().upsertMirror(USER_IDS[0], mirror());
      await repository().upsertMirror(
        USER_IDS[0],
        mirror({ title: "Standup (moved)" }),
      );

      const rows = await mirrorRows(USER_IDS[0]);
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("Standup (moved)");
    });

    it("keeps two accounts sharing a Google identity from colliding", async () => {
      await repository().upsertMirror(USER_IDS[0], mirror({ title: "Owner" }));
      await repository().upsertMirror(
        USER_IDS[1],
        mirror({ title: "Neighbor" }),
      );

      expect(await mirrorRows(USER_IDS[0])).toHaveLength(1);
      expect(await mirrorRows(USER_IDS[1])).toHaveLength(1);
      expect((await mirrorRows(USER_IDS[0]))[0].title).toBe("Owner");
      expect((await mirrorRows(USER_IDS[1]))[0].title).toBe("Neighbor");
    });

    it("removes a mirror row when Google reports the event gone", async () => {
      await repository().upsertMirror(USER_IDS[0], mirror());
      await repository().removeMirror(
        USER_IDS[0],
        "primary@example.com",
        "g-evt-1",
      );

      expect(await mirrorRows(USER_IDS[0])).toHaveLength(0);
    });

    it("removeMirror is a no-op for an unknown event", async () => {
      await expect(
        repository().removeMirror(USER_IDS[0], "primary@example.com", "nope"),
      ).resolves.toBeUndefined();
    });

    it("scopes mirror removal to the owning account", async () => {
      await repository().upsertMirror(USER_IDS[0], mirror());
      await repository().removeMirror(
        USER_IDS[1],
        "primary@example.com",
        "g-evt-1",
      );

      expect(await mirrorRows(USER_IDS[0])).toHaveLength(1);
    });

    it("clears one calendar's mirror for 410 recovery, sparing others", async () => {
      await repository().upsertMirror(
        USER_IDS[0],
        mirror({ googleEventId: "a", googleCalendarId: "primary@example.com" }),
      );
      await repository().upsertMirror(
        USER_IDS[0],
        mirror({ googleEventId: "b", googleCalendarId: "primary@example.com" }),
      );
      await repository().upsertMirror(
        USER_IDS[0],
        mirror({ googleEventId: "c", googleCalendarId: "other@example.com" }),
      );

      await repository().removeMirrorForCalendar(
        USER_IDS[0],
        "primary@example.com",
      );

      const rows = await mirrorRows(USER_IDS[0]);
      expect(rows).toHaveLength(1);
      expect(rows[0].googleCalendarId).toBe("other@example.com");
    });

    it("scopes calendar-wide mirror clearing to the owning account", async () => {
      await repository().upsertMirror(USER_IDS[0], mirror());
      await repository().removeMirrorForCalendar(
        USER_IDS[1],
        "primary@example.com",
      );

      expect(await mirrorRows(USER_IDS[0])).toHaveLength(1);
    });

    it("mirrors an all-day event with its date bounds", async () => {
      await repository().upsertMirror(
        USER_IDS[0],
        mirror({
          googleEventId: "g-allday",
          isAllDay: true,
          allDayStartDate: "2026-12-25",
          allDayEndDate: "2026-12-26",
        }),
      );

      const [row] = await connection!.database
        .select()
        .from(event)
        .where(
          and(
            eq(event.userId, USER_IDS[0]),
            eq(event.googleEventId, "g-allday"),
          ),
        );
      expect(row.isAllDay).toBe(true);
      expect(row.allDayStartDate).toBe("2026-12-25");
      expect(row.allDayEndDate).toBe("2026-12-26");
    });
  },
);
