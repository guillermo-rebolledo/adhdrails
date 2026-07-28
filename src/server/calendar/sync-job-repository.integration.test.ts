import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseConnection } from "@/server/db/client";
import { calendarSyncJob, user } from "@/server/db/schema";

import { createCalendarSyncJobRepository } from "./sync-job-repository";

const DATABASE_URL = process.env.DATABASE_URL;
const USER_IDS = ["job-owner", "job-neighbor"];

const connection = DATABASE_URL
  ? createDatabaseConnection(DATABASE_URL)
  : undefined;

function enqueueInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER_IDS[0],
    googleCalendarId: "primary@example.com",
    channelId: "chan-1",
    messageNumber: 1,
    ...overrides,
  } as {
    userId: string;
    googleCalendarId: string;
    channelId: string;
    messageNumber: number;
  };
}

describe.skipIf(!connection)(
  "Calendar sync job outbox PostgreSQL integration",
  () => {
    const repository = () =>
      createCalendarSyncJobRepository(connection!.database);

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

    it("enqueues a new job as pending", async () => {
      const { enqueued, job } = await repository().enqueue(enqueueInput());
      expect(enqueued).toBe(true);
      expect(job).toMatchObject({
        status: "pending",
        attempts: 0,
        messageNumber: 1,
      });
    });

    it("is idempotent on duplicate delivery: one row, the same job returned", async () => {
      const first = await repository().enqueue(enqueueInput());
      const second = await repository().enqueue(enqueueInput());

      expect(second.enqueued).toBe(false);
      expect(second.job.id).toBe(first.job.id);

      const rows = await connection!.database
        .select()
        .from(calendarSyncJob)
        .where(eq(calendarSyncJob.channelId, "chan-1"));
      expect(rows).toHaveLength(1);
    });

    it("distinguishes deliveries by message number", async () => {
      await repository().enqueue(enqueueInput({ messageNumber: 1 }));
      await repository().enqueue(enqueueInput({ messageNumber: 2 }));

      const pending = await repository().listPending(10);
      expect(pending.map((job) => job.messageNumber).sort()).toEqual([1, 2]);
    });

    it("advances a job through processing to completed, counting the attempt", async () => {
      const { job } = await repository().enqueue(enqueueInput());

      await repository().markProcessing(job.id);
      await repository().markCompleted(job.id);

      const stored = await repository().getById(job.id);
      expect(stored).toMatchObject({
        status: "completed",
        attempts: 1,
        lastErrorCode: null,
      });
      // A completed job no longer appears in the pending drain.
      expect(await repository().listPending(10)).toEqual([]);
    });

    it("records a safe error code on failure for visibility, never a payload", async () => {
      const { job } = await repository().enqueue(enqueueInput());

      await repository().markProcessing(job.id);
      await repository().markFailed(job.id, "unauthorized");

      const stored = await repository().getById(job.id);
      expect(stored).toMatchObject({
        status: "failed",
        lastErrorCode: "unauthorized",
      });
    });
  },
);
