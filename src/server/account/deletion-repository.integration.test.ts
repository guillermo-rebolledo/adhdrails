import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseConnection } from "@/server/db/client";
import {
  account,
  accountDeletion,
  calendarSyncJob,
  dataExport,
  eventExportJob,
  operationalAudit,
  pushSubscription,
  task,
  user,
} from "@/server/db/schema";

import { createAccountDeletionRepository } from "./deletion-repository";

const DATABASE_URL = process.env.DATABASE_URL;
const USER_ID = "deletion-owner";
const CORRELATION_IDS = [
  "cor_request",
  "cor_complete",
  "cor_retention",
  "cor_retention_complete",
];
const connection = DATABASE_URL
  ? createDatabaseConnection(DATABASE_URL)
  : undefined;

describe.skipIf(!connection)(
  "Account deletion repository PostgreSQL integration",
  () => {
    const db = () => connection!.database;
    const repository = () => createAccountDeletionRepository(db());

    async function cleanDeletionRecords() {
      const audits = await db()
        .select({ accountReference: operationalAudit.accountReference })
        .from(operationalAudit)
        .where(inArray(operationalAudit.correlationId, CORRELATION_IDS));
      await db()
        .delete(operationalAudit)
        .where(inArray(operationalAudit.correlationId, CORRELATION_IDS));
      const references = audits.flatMap((row) =>
        row.accountReference ? [row.accountReference] : [],
      );
      if (references.length > 0) {
        await db()
          .delete(accountDeletion)
          .where(inArray(accountDeletion.pseudonymousAccountId, references));
      }
    }

    beforeEach(async () => {
      await cleanDeletionRecords();
      await db()
        .delete(accountDeletion)
        .where(eq(accountDeletion.userId, USER_ID));
      await db().delete(user).where(eq(user.id, USER_ID));
      await db().insert(user).values({
        id: USER_ID,
        name: "Deletion Owner",
        email: "deletion-owner@example.test",
      });
      await db().insert(account).values({
        id: "deletion-google-account",
        accountId: "google-subject",
        providerId: "google",
        userId: USER_ID,
        refreshToken: "identity-refresh-token",
      });
      await db().insert(task).values({
        id: "1942d2bc-567d-4d2f-9970-aee85d8f6a26",
        userId: USER_ID,
        title: "Private task content",
        idempotencyKey: "2cf9a17e-323c-4841-884a-b3ff67691742",
      });
      await db().insert(pushSubscription).values({
        id: "dd011117-7fb4-44e1-9625-e4a45be50ead",
        userId: USER_ID,
        endpoint: "https://push.example.test/deletion-owner",
        p256dh: "p256dh",
        auth: "auth",
      });
      await db().insert(calendarSyncJob).values({
        id: "3425c864-e9b9-43c5-b293-a9e9e2336f33",
        userId: USER_ID,
        googleCalendarId: "primary",
        channelId: "deletion-channel",
        messageNumber: 1,
      });
      await db().insert(eventExportJob).values({
        id: "34e27f7b-83f5-4e87-bba9-5ad23597b381",
        userId: USER_ID,
        eventId: "287b4862-df03-445b-8663-2d46425f2f00",
        operation: "upsert",
      });
      await db().insert(dataExport).values({
        id: "2f263009-a6e5-46a0-872d-24dad7111a9a",
        userId: USER_ID,
      });
    });

    afterAll(async () => {
      await cleanDeletionRecords();
      await db().delete(user).where(eq(user.id, USER_ID));
      await connection!.close();
    });

    it("disables access immediately, cascades active data, and retains only pseudonymous metadata", async () => {
      const requestedAt = new Date("2026-07-28T12:00:00.000Z");
      const { record } = await repository().create(
        USER_ID,
        "cor_request",
        requestedAt,
      );

      const [disabled] = await db()
        .select({ deletionRequestedAt: user.deletionRequestedAt })
        .from(user)
        .where(eq(user.id, USER_ID));
      expect(disabled.deletionRequestedAt?.toISOString()).toBe(
        requestedAt.toISOString(),
      );
      await expect(
        db()
          .select()
          .from(calendarSyncJob)
          .where(eq(calendarSyncJob.userId, USER_ID)),
      ).resolves.toHaveLength(0);
      await expect(
        db()
          .select()
          .from(eventExportJob)
          .where(eq(eventExportJob.userId, USER_ID)),
      ).resolves.toHaveLength(0);
      await expect(
        db().select().from(dataExport).where(eq(dataExport.userId, USER_ID)),
      ).resolves.toHaveLength(0);
      await expect(
        db()
          .select()
          .from(pushSubscription)
          .where(eq(pushSubscription.userId, USER_ID)),
      ).resolves.toHaveLength(0);
      await expect(
        repository().listIdentityProviderTokens(USER_ID),
      ).resolves.toEqual(["identity-refresh-token"]);

      await repository().markCompleted(
        record.id,
        "cor_complete",
        new Date("2026-07-28T12:01:00.000Z"),
      );
      await repository().markFailed(
        record.id,
        "late_worker_failure",
        "cor_complete",
        new Date("2026-07-28T12:02:00.000Z"),
      );

      expect(
        await db().select().from(user).where(eq(user.id, USER_ID)),
      ).toHaveLength(0);
      expect(
        await db().select().from(task).where(eq(task.userId, USER_ID)),
      ).toHaveLength(0);

      const [tombstone] = await db()
        .select()
        .from(accountDeletion)
        .where(eq(accountDeletion.id, record.id));
      expect(tombstone).toMatchObject({
        userId: null,
        status: "completed",
        lastErrorCode: null,
      });

      const audits = await db()
        .select()
        .from(operationalAudit)
        .where(
          inArray(operationalAudit.correlationId, [
            "cor_request",
            "cor_complete",
          ]),
        );
      expect(audits).toHaveLength(2);
      expect(
        audits.every(
          (row) => row.accountReference === record.pseudonymousAccountId,
        ),
      ).toBe(true);
      expect(JSON.stringify(audits)).not.toContain("deletion-owner");
      expect(JSON.stringify(audits)).not.toContain("Private task content");
      expect(JSON.stringify(audits)).not.toContain("identity-refresh-token");
    });

    it("redelivers only after an abandoned processing lease expires", async () => {
      const requestedAt = new Date("2026-07-28T12:00:00.000Z");
      const { record } = await repository().create(
        USER_ID,
        "cor_request",
        requestedAt,
      );
      await repository().markProcessing(record.id, requestedAt);
      await expect(
        repository().markProcessing(
          record.id,
          new Date("2026-07-28T12:14:59.000Z"),
        ),
      ).resolves.toBe(false);

      await expect(
        repository().listDispatchable(10, new Date("2026-07-28T12:14:59.000Z")),
      ).resolves.toEqual([]);
      await expect(
        repository().listDispatchable(10, new Date("2026-07-28T12:15:00.000Z")),
      ).resolves.toEqual([expect.objectContaining({ id: record.id })]);
      await expect(
        repository().markProcessing(
          record.id,
          new Date("2026-07-28T12:15:00.000Z"),
        ),
      ).resolves.toBe(true);
    });

    it("purges tombstones after 30 days and audit metadata after 90 days", async () => {
      const requestedAt = new Date("2026-01-01T00:00:00.000Z");
      const { record } = await repository().create(
        USER_ID,
        "cor_retention",
        requestedAt,
      );
      await repository().markCompleted(
        record.id,
        "cor_retention_complete",
        requestedAt,
      );

      await expect(
        repository().purgeExpired(new Date("2026-01-30T23:59:59.000Z")),
      ).resolves.toEqual({ tombstones: 0, auditRecords: 0 });
      await expect(
        repository().purgeExpired(new Date("2026-01-31T00:00:00.000Z")),
      ).resolves.toEqual({ tombstones: 1, auditRecords: 0 });
      await expect(
        repository().purgeExpired(new Date("2026-04-01T00:00:00.000Z")),
      ).resolves.toEqual({ tombstones: 0, auditRecords: 2 });
    });
  },
);
