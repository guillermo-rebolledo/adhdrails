import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseConnection } from "@/server/db/client";
import { eventExportJob, user } from "@/server/db/schema";

import { createEventExportJobRepository } from "./export-job-repository";

const DATABASE_URL = process.env.DATABASE_URL;
const USER_IDS = ["exp-owner", "exp-neighbor"];
const EVENT_ID = "11111111-1111-4111-8111-111111111111";

const connection = DATABASE_URL
  ? createDatabaseConnection(DATABASE_URL)
  : undefined;

describe.skipIf(!connection)(
  "Event export job repository PostgreSQL integration",
  () => {
    const repository = () =>
      createEventExportJobRepository(connection!.database);

    async function jobRows(userId: string) {
      return connection!.database
        .select()
        .from(eventExportJob)
        .where(eq(eventExportJob.userId, userId));
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

    it("enqueues a pending upsert job", async () => {
      const job = await repository().enqueue({
        userId: "exp-owner",
        eventId: EVENT_ID,
        operation: "upsert",
        googleCalendarId: "primary@example.com",
      });

      expect(job.status).toBe("pending");
      expect(job.operation).toBe("upsert");
      expect(job.googleCalendarId).toBe("primary@example.com");
      expect(await jobRows("exp-owner")).toHaveLength(1);
    });

    it("re-arms an existing job instead of duplicating it", async () => {
      const repo = repository();
      const first = await repo.enqueue({
        userId: "exp-owner",
        eventId: EVENT_ID,
        operation: "upsert",
        googleCalendarId: "primary@example.com",
      });
      await repo.markProcessing(first.id);
      await repo.markFailed(first.id, "unauthorized");

      const rearmed = await repo.enqueue({
        userId: "exp-owner",
        eventId: EVENT_ID,
        operation: "upsert",
        googleCalendarId: "team@group.calendar.google.com",
      });

      expect(rearmed.id).toBe(first.id);
      expect(rearmed.status).toBe("pending");
      expect(rearmed.attempts).toBe(0);
      expect(rearmed.lastErrorCode).toBeNull();
      expect(rearmed.googleCalendarId).toBe("team@group.calendar.google.com");
      expect(await jobRows("exp-owner")).toHaveLength(1);
    });

    it("keeps upsert and delete jobs for one event separate", async () => {
      const repo = repository();
      await repo.enqueue({
        userId: "exp-owner",
        eventId: EVENT_ID,
        operation: "upsert",
        googleCalendarId: "primary@example.com",
      });
      await repo.enqueue({
        userId: "exp-owner",
        eventId: EVENT_ID,
        operation: "delete",
        googleCalendarId: "primary@example.com",
        googleEventId: "g-1",
      });

      expect(await jobRows("exp-owner")).toHaveLength(2);
    });

    it("lists only pending jobs, oldest first", async () => {
      const repo = repository();
      const a = await repo.enqueue({
        userId: "exp-owner",
        eventId: EVENT_ID,
        operation: "upsert",
      });
      const b = await repo.enqueue({
        userId: "exp-owner",
        eventId: "22222222-2222-4222-8222-222222222222",
        operation: "upsert",
      });
      await repo.markProcessing(b.id);
      await repo.markCompleted(b.id);

      const pending = await repo.listPending(10);
      expect(pending.map((job) => job.id)).toEqual([a.id]);
    });

    it("completes a processing job but preserves a concurrent re-arm", async () => {
      const repo = repository();
      const job = await repo.enqueue({
        userId: "exp-owner",
        eventId: EVENT_ID,
        operation: "upsert",
      });
      await repo.markProcessing(job.id);

      // A new edit re-arms the job to pending while the run is still in flight.
      await repo.enqueue({
        userId: "exp-owner",
        eventId: EVENT_ID,
        operation: "upsert",
      });

      // The in-flight run's completion must not overwrite the newer pending state.
      await repo.markCompleted(job.id);

      const pending = await repo.listPending(10);
      expect(pending.map((row) => row.id)).toEqual([job.id]);
    });

    it("scopes jobs by account", async () => {
      const repo = repository();
      await repo.enqueue({
        userId: "exp-owner",
        eventId: EVENT_ID,
        operation: "upsert",
      });
      await repo.enqueue({
        userId: "exp-neighbor",
        eventId: EVENT_ID,
        operation: "upsert",
      });

      expect(await jobRows("exp-owner")).toHaveLength(1);
      expect(await jobRows("exp-neighbor")).toHaveLength(1);
    });

    it("purges resolved rows older than the cutoff, sparing recent and pending work", async () => {
      const repo = repository();
      // An old completed row, aged before the cutoff.
      const old = await repo.enqueue({
        userId: "exp-owner",
        eventId: EVENT_ID,
        operation: "upsert",
      });
      await repo.markProcessing(old.id);
      await repo.markCompleted(old.id);
      await connection!.database
        .update(eventExportJob)
        .set({ updatedAt: new Date("2026-01-01T00:00:00.000Z") })
        .where(eq(eventExportJob.id, old.id));

      // A recent skipped row and a still-pending row must survive.
      const recent = await repo.enqueue({
        userId: "exp-owner",
        eventId: "22222222-2222-4222-8222-222222222222",
        operation: "upsert",
      });
      await repo.markProcessing(recent.id);
      await repo.markSkipped(recent.id, "no_writable_calendar");
      const pending = await repo.enqueue({
        userId: "exp-owner",
        eventId: "33333333-3333-4333-8333-333333333333",
        operation: "upsert",
      });

      const purged = await repo.purgeResolvedBefore(
        new Date("2026-06-01T00:00:00.000Z"),
      );

      expect(purged).toBe(1);
      expect(await repo.getById(old.id)).toBeNull();
      expect(await repo.getById(recent.id)).not.toBeNull();
      expect(await repo.getById(pending.id)).not.toBeNull();
    });
  },
);
