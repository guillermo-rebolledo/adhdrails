import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseConnection } from "@/server/db/client";
import {
  area,
  dataExport,
  event,
  focusSession,
  inboxItem,
  reminderPreference,
  task,
  thought,
  user,
} from "@/server/db/schema";

import { createDataExportRepository } from "./data-export-repository";

const DATABASE_URL = process.env.DATABASE_URL;
const USER_IDS = ["export-owner", "export-neighbor"];

const connection = DATABASE_URL
  ? createDatabaseConnection(DATABASE_URL)
  : undefined;

describe.skipIf(!connection)(
  "Data export repository PostgreSQL integration",
  () => {
    const db = () => connection!.database;
    const repository = () => createDataExportRepository(db());

    beforeEach(async () => {
      await db().delete(user).where(inArray(user.id, USER_IDS));
      await db()
        .insert(user)
        .values(
          USER_IDS.map((id) => ({
            id,
            name: `${id} name`,
            email: `${id}@example.test`,
            timezone: "America/New_York",
            locale: "en-GB",
          })),
        );
    });

    afterAll(async () => {
      await db().delete(user).where(inArray(user.id, USER_IDS));
      await connection!.close();
    });

    it("creates a pending export", async () => {
      const { created, record } = await repository().create(USER_IDS[0]);

      expect(created).toBe(true);
      expect(record).toMatchObject({
        status: "pending",
        attempts: 0,
        byteSize: null,
      });
    });

    it("re-arms rather than piling up while one is in flight", async () => {
      const first = await repository().create(USER_IDS[0]);
      const second = await repository().create(USER_IDS[0]);

      expect(second.created).toBe(false);
      expect(second.record.id).toBe(first.record.id);

      const rows = await db()
        .select()
        .from(dataExport)
        .where(eq(dataExport.userId, USER_IDS[0]));
      expect(rows).toHaveLength(1);
    });

    it("allows a fresh export once the prior one is resolved", async () => {
      const first = await repository().create(USER_IDS[0]);
      await repository().markProcessing(first.record.id);
      await repository().markCompleted(first.record.id, {
        payload: "{}",
        byteSize: 2,
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      const second = await repository().create(USER_IDS[0]);
      expect(second.created).toBe(true);
      expect(second.record.id).not.toBe(first.record.id);
    });

    it("advances the lifecycle and stores the archive for download", async () => {
      const { record } = await repository().create(USER_IDS[0]);
      await repository().markProcessing(record.id);
      const expiresAt = new Date(Date.now() + 3_600_000);
      await repository().markCompleted(record.id, {
        payload: '{"schemaVersion":1}',
        byteSize: 19,
        expiresAt,
      });

      const latest = await repository().getLatest(USER_IDS[0]);
      expect(latest).toMatchObject({
        status: "completed",
        attempts: 1,
        byteSize: 19,
      });

      const download = await repository().getLatestCompletedDownload(
        USER_IDS[0],
      );
      expect(download?.payload).toBe('{"schemaVersion":1}');
      expect(download?.expiresAt?.getTime()).toBe(expiresAt.getTime());
    });

    it("records a failure with a safe code and no payload", async () => {
      const { record } = await repository().create(USER_IDS[0]);
      await repository().markProcessing(record.id);
      await repository().markFailed(record.id, "collection_failed");

      const latest = await repository().getLatest(USER_IDS[0]);
      expect(latest).toMatchObject({
        status: "failed",
        lastErrorCode: "collection_failed",
      });

      const download = await repository().getLatestCompletedDownload(
        USER_IDS[0],
      );
      expect(download).toBeNull();
    });

    it("expires completed archives past their window and clears the payload", async () => {
      const { record } = await repository().create(USER_IDS[0]);
      await repository().markProcessing(record.id);
      await repository().markCompleted(record.id, {
        payload: "{}",
        byteSize: 2,
        expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      const count = await repository().expireCompleted(
        new Date("2026-01-02T00:00:00.000Z"),
      );
      expect(count).toBe(1);

      const latest = await repository().getLatest(USER_IDS[0]);
      expect(latest?.status).toBe("expired");

      const [row] = await db()
        .select({ payload: dataExport.payload })
        .from(dataExport)
        .where(eq(dataExport.id, record.id));
      expect(row.payload).toBeNull();
    });

    it("lists pending jobs oldest first", async () => {
      const first = await repository().create(USER_IDS[0]);
      const second = await repository().create(USER_IDS[1]);

      const pending = await repository().listPending(10);
      expect(pending.map((job) => job.id)).toEqual([
        first.record.id,
        second.record.id,
      ]);
    });

    it("collects only the owning account's app-owned data", async () => {
      const now = new Date("2026-02-01T00:00:00.000Z");
      await db().insert(area).values({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userId: USER_IDS[0],
        name: "Deep work",
        idempotencyKey: crypto.randomUUID(),
      });
      await db().insert(task).values({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        userId: USER_IDS[0],
        title: "Owned task",
        idempotencyKey: crypto.randomUUID(),
      });
      // A neighbour's task must never appear in this account's export.
      await db().insert(task).values({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        userId: USER_IDS[1],
        title: "Neighbour task",
        idempotencyKey: crypto.randomUUID(),
      });
      await db()
        .insert(thought)
        .values([
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            userId: USER_IDS[0],
            title: "Kept thought",
            body: "",
            lastMutationKey: crypto.randomUUID(),
          },
          {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            userId: USER_IDS[0],
            title: "Deleted thought",
            body: "",
            lastMutationKey: crypto.randomUUID(),
            deletedAt: now,
          },
        ]);
      await db().insert(inboxItem).values({
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        userId: USER_IDS[0],
        title: "Owned capture",
        idempotencyKey: crypto.randomUUID(),
      });
      await db()
        .insert(event)
        .values([
          {
            id: "10101010-1010-4010-8010-101010101010",
            userId: USER_IDS[0],
            title: "Local event",
            startAt: now,
            endAt: now,
            startTimeZone: "America/New_York",
            endTimeZone: "America/New_York",
            origin: "local",
            idempotencyKey: crypto.randomUUID(),
          },
          {
            id: "20202020-2020-4020-8020-202020202020",
            userId: USER_IDS[0],
            title: "Synced event",
            startAt: now,
            endAt: now,
            startTimeZone: "America/New_York",
            endTimeZone: "America/New_York",
            origin: "synced",
            googleCalendarId: "primary@example.com",
            googleEventId: "gid-1",
            idempotencyKey: crypto.randomUUID(),
          },
        ]);
      await db().insert(focusSession).values({
        id: "30303030-3030-4030-8030-303030303030",
        userId: USER_IDS[0],
        taskId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        status: "completed",
        accumulatedSeconds: 1500,
        idempotencyKey: crypto.randomUUID(),
      });
      await db()
        .insert(reminderPreference)
        .values({ userId: USER_IDS[0], enabled: true, leadMinutes: 30 });

      const data = await repository().collectAccountData(USER_IDS[0]);

      expect(data).not.toBeNull();
      expect(data!.account.email).toBe("export-owner@example.test");
      expect(data!.areas.map((a) => a.name)).toEqual(["Deep work"]);
      expect(data!.tasks.map((t) => t.title)).toEqual(["Owned task"]);
      expect(data!.thoughts.map((t) => t.title)).toEqual(["Kept thought"]);
      expect(data!.inboxItems).toHaveLength(1);
      // The mirror is still returned raw here; the domain builder drops it.
      expect(data!.events).toHaveLength(2);
      expect(data!.focusSessions).toHaveLength(1);
      expect(data!.reminderPreferences).toMatchObject({
        enabled: true,
        leadMinutes: 30,
      });
    });

    it("returns null collecting data for a missing account", async () => {
      const data = await repository().collectAccountData("nobody");
      expect(data).toBeNull();
    });
  },
);
