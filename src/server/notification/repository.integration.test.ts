import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseConnection } from "@/server/db/client";
import { task, user } from "@/server/db/schema";

import { createNotificationRepository } from "./repository";

const DATABASE_URL = process.env.DATABASE_URL;
const USERS = ["reminder-owner", "reminder-neighbor"];
const TASKS = {
  timed: "a1000000-0000-4000-8000-000000000001",
  dateOnly: "a1000000-0000-4000-8000-000000000002",
};
const SUBSCRIPTION = "b2000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-04T12:50:30.000Z");
const connection = DATABASE_URL
  ? createDatabaseConnection(DATABASE_URL)
  : undefined;

describe.skipIf(!connection)(
  "Notification repository PostgreSQL integration",
  () => {
    beforeAll(async () => {
      await connection!.database.insert(user).values([
        {
          id: USERS[0],
          name: "Reminder owner",
          email: "reminder-owner@example.test",
          timezone: "America/New_York",
        },
        {
          id: USERS[1],
          name: "Reminder neighbor",
          email: "reminder-neighbor@example.test",
        },
      ]);
      await connection!.database.insert(task).values([
        {
          id: TASKS.timed,
          userId: USERS[0],
          title: "Private timed task",
          scheduledDate: "2026-08-04",
          scheduledTime: "09:00",
          idempotencyKey: crypto.randomUUID(),
        },
        {
          id: TASKS.dateOnly,
          userId: USERS[0],
          title: "Date-only task",
          scheduledDate: "2026-08-04",
          idempotencyKey: crypto.randomUUID(),
        },
      ]);
    });

    afterAll(async () => {
      if (!connection) return;
      await connection.database.delete(user).where(inArray(user.id, USERS));
      await connection.close();
    });

    it("keeps preferences and device subscriptions account-scoped", async () => {
      const repository = createNotificationRepository(connection!.database);
      await repository.savePreferences(USERS[0], {
        enabled: true,
        headsUpEnabled: true,
        leadMinutes: 10,
        atTimeEnabled: false,
        eventCueEnabled: true,
      });
      await repository.saveSubscription(USERS[0], {
        id: SUBSCRIPTION,
        endpoint: "https://push.example/reminder-owner",
        expirationTime: null,
        p256dh: "public-key",
        auth: "auth-secret",
      });

      expect(
        await repository.getSubscription(USERS[1], SUBSCRIPTION),
      ).toBeNull();
      await repository.deleteSubscription(USERS[1], SUBSCRIPTION);
      expect(
        await repository.getSubscription(USERS[0], SUBSCRIPTION),
      ).not.toBeNull();

      const candidates = await repository.listCandidates(NOW);
      expect(candidates.map((candidate) => candidate.taskId)).toEqual([
        TASKS.timed,
      ]);
    });

    it("claims a per-device delivery once and reclaims it only when retry is due", async () => {
      const repository = createNotificationRepository(connection!.database);
      const input = {
        userId: USERS[0],
        subscriptionId: SUBSCRIPTION,
        taskId: TASKS.timed,
        kind: "heads_up" as const,
        scheduledFor: new Date("2026-08-04T12:50:00.000Z"),
        now: NOW,
      };

      const first = await repository.claimDelivery(input);
      expect(first).toMatchObject({ attempt: 1 });
      expect(await repository.claimDelivery(input)).toBeNull();

      await repository.failDelivery(
        first!.id,
        new Date("2026-08-04T12:52:30.000Z"),
        "push_unavailable",
      );
      expect(
        await repository.claimDelivery({
          ...input,
          now: new Date("2026-08-04T12:51:00.000Z"),
        }),
      ).toBeNull();
      expect(
        await repository.claimDelivery({
          ...input,
          now: new Date("2026-08-04T12:53:00.000Z"),
        }),
      ).toMatchObject({ attempt: 2 });
    });
  },
);
