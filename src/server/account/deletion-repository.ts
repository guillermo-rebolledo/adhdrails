import { and, asc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import {
  ACCOUNT_DELETION_TOMBSTONE_TTL_MS,
  OPERATIONAL_AUDIT_TTL_MS,
  type AccountDeletionStatus,
  retentionDeadline,
} from "@/domain/account/deletion";
import type { Database } from "@/server/db/connection";
import {
  account,
  accountDeletion,
  calendarSyncJob,
  dataExport,
  eventExportJob,
  operationalAudit,
  pushSubscription,
  user,
} from "@/server/db/schema";

const PROCESSING_LEASE_MS = 15 * 60_000;

export interface AccountDeletionRecord {
  id: string;
  userId: string | null;
  pseudonymousAccountId: string;
  status: AccountDeletionStatus;
  attempts: number;
  lastErrorCode: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  purgeAfter: Date;
}

const recordColumns = {
  id: accountDeletion.id,
  userId: accountDeletion.userId,
  pseudonymousAccountId: accountDeletion.pseudonymousAccountId,
  status: accountDeletion.status,
  attempts: accountDeletion.attempts,
  lastErrorCode: accountDeletion.lastErrorCode,
  requestedAt: accountDeletion.requestedAt,
  completedAt: accountDeletion.completedAt,
  purgeAfter: accountDeletion.purgeAfter,
};

function toRecord(row: {
  id: string;
  userId: string | null;
  pseudonymousAccountId: string;
  status: string;
  attempts: number;
  lastErrorCode: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  purgeAfter: Date;
}): AccountDeletionRecord {
  return { ...row, status: row.status as AccountDeletionStatus };
}

function auditValues(input: {
  accountReference: string;
  action: string;
  target: string;
  outcome: string;
  safeCode?: string;
  correlationId: string;
  at: Date;
}) {
  return {
    id: crypto.randomUUID(),
    accountReference: input.accountReference,
    action: input.action,
    opaqueTarget: input.target,
    outcome: input.outcome,
    safeCode: input.safeCode ?? null,
    correlationId: input.correlationId,
    occurredAt: input.at,
    purgeAfter: retentionDeadline(input.at, OPERATIONAL_AUDIT_TTL_MS),
  };
}

async function findActive(database: Database, userId: string) {
  const [row] = await database
    .select(recordColumns)
    .from(accountDeletion)
    .where(eq(accountDeletion.userId, userId))
    .limit(1);
  return row ? toRecord(row) : null;
}

/** Persistence for the durable account-deletion workflow and retention sweeps. */
export function createAccountDeletionRepository(database: Database) {
  return {
    async create(
      userId: string,
      correlationId: string,
      at: Date,
    ): Promise<{ created: boolean; record: AccountDeletionRecord }> {
      const existing = await findActive(database, userId);
      if (existing) {
        return { created: false, record: existing };
      }

      return database.transaction(async (tx) => {
        const [disabled] = await tx
          .update(user)
          .set({ deletionRequestedAt: at, updatedAt: at })
          .where(
            and(eq(user.id, userId), sql`${user.deletionRequestedAt} is null`),
          )
          .returning({ id: user.id });

        if (!disabled) {
          const active = await findActive(database, userId);
          if (active) {
            return { created: false, record: active };
          }
          throw new Error("account_missing");
        }

        // Neutralize every local delivery/outbox before cleanup leaves this
        // transaction. Already-dispatched workers resolve their row by id and
        // become no-ops; deleting subscriptions also cascades reminder retries.
        await tx
          .delete(calendarSyncJob)
          .where(eq(calendarSyncJob.userId, userId));
        await tx
          .delete(eventExportJob)
          .where(eq(eventExportJob.userId, userId));
        await tx.delete(dataExport).where(eq(dataExport.userId, userId));
        await tx
          .delete(pushSubscription)
          .where(eq(pushSubscription.userId, userId));

        const id = crypto.randomUUID();
        const pseudonymousAccountId = crypto.randomUUID();
        const [inserted] = await tx
          .insert(accountDeletion)
          .values({
            id,
            userId,
            pseudonymousAccountId,
            requestedAt: at,
            purgeAfter: retentionDeadline(
              at,
              ACCOUNT_DELETION_TOMBSTONE_TTL_MS,
            ),
            updatedAt: at,
          })
          .returning();

        await tx.insert(operationalAudit).values(
          auditValues({
            accountReference: pseudonymousAccountId,
            action: "account.deletion_requested",
            target: id,
            outcome: "accepted",
            correlationId,
            at,
          }),
        );

        return { created: true, record: toRecord(inserted) };
      });
    },

    async getById(id: string): Promise<AccountDeletionRecord | null> {
      const [row] = await database
        .select(recordColumns)
        .from(accountDeletion)
        .where(eq(accountDeletion.id, id))
        .limit(1);
      return row ? toRecord(row) : null;
    },

    async listDispatchable(
      limit: number,
      at = new Date(),
    ): Promise<AccountDeletionRecord[]> {
      const staleBefore = new Date(at.getTime() - PROCESSING_LEASE_MS);
      const rows = await database
        .select(recordColumns)
        .from(accountDeletion)
        .where(
          or(
            inArray(accountDeletion.status, ["pending", "failed"]),
            and(
              eq(accountDeletion.status, "processing"),
              or(
                isNull(accountDeletion.processingAt),
                lte(accountDeletion.processingAt, staleBefore),
              ),
            ),
          ),
        )
        .orderBy(asc(accountDeletion.requestedAt), asc(accountDeletion.id))
        .limit(limit);
      return rows.map(toRecord);
    },

    async markProcessing(id: string, at: Date): Promise<boolean> {
      const staleBefore = new Date(at.getTime() - PROCESSING_LEASE_MS);
      const [claimed] = await database
        .update(accountDeletion)
        .set({
          status: "processing",
          attempts: sql`${accountDeletion.attempts} + 1`,
          processingAt: at,
          lastErrorCode: null,
          updatedAt: at,
        })
        .where(
          and(
            eq(accountDeletion.id, id),
            or(
              inArray(accountDeletion.status, ["pending", "failed"]),
              and(
                eq(accountDeletion.status, "processing"),
                or(
                  isNull(accountDeletion.processingAt),
                  lte(accountDeletion.processingAt, staleBefore),
                ),
              ),
            ),
          ),
        )
        .returning({ id: accountDeletion.id });
      return Boolean(claimed);
    },

    async listIdentityProviderTokens(userId: string): Promise<string[]> {
      const rows = await database
        .select({
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
        })
        .from(account)
        .where(
          and(eq(account.userId, userId), eq(account.providerId, "google")),
        );

      return [
        ...new Set(
          rows.flatMap((row) =>
            [row.refreshToken, row.accessToken].filter(
              (token): token is string => Boolean(token),
            ),
          ),
        ),
      ];
    },

    async markCompleted(
      id: string,
      correlationId: string,
      at: Date,
    ): Promise<void> {
      await database.transaction(async (tx) => {
        const [job] = await tx
          .update(accountDeletion)
          .set({
            status: "completed",
            completedAt: at,
            purgeAfter: retentionDeadline(
              at,
              ACCOUNT_DELETION_TOMBSTONE_TTL_MS,
            ),
            lastErrorCode: null,
            updatedAt: at,
          })
          .where(
            and(
              eq(accountDeletion.id, id),
              ne(accountDeletion.status, "completed"),
            ),
          )
          .returning(recordColumns);
        if (!job) {
          return;
        }

        await tx.insert(operationalAudit).values(
          auditValues({
            accountReference: job.pseudonymousAccountId,
            action: "account.deleted",
            target: id,
            outcome: "success",
            correlationId,
            at,
          }),
        );

        if (job.userId) {
          await tx.delete(user).where(eq(user.id, job.userId));
        }
      });
    },

    async markFailed(
      id: string,
      safeCode: string,
      correlationId: string,
      at: Date,
    ): Promise<void> {
      await database.transaction(async (tx) => {
        const [job] = await tx
          .update(accountDeletion)
          .set({ status: "failed", lastErrorCode: safeCode, updatedAt: at })
          .where(
            and(
              eq(accountDeletion.id, id),
              ne(accountDeletion.status, "completed"),
            ),
          )
          .returning(recordColumns);
        if (!job) {
          return;
        }
        await tx.insert(operationalAudit).values(
          auditValues({
            accountReference: job.pseudonymousAccountId,
            action: "account.deletion_failed",
            target: id,
            outcome: "failure",
            safeCode,
            correlationId,
            at,
          }),
        );
      });
    },

    async purgeExpired(at: Date): Promise<{
      tombstones: number;
      auditRecords: number;
    }> {
      const tombstones = await database
        .delete(accountDeletion)
        .where(
          and(
            eq(accountDeletion.status, "completed"),
            lte(accountDeletion.purgeAfter, at),
          ),
        )
        .returning({ id: accountDeletion.id });
      const auditRecords = await database
        .delete(operationalAudit)
        .where(lte(operationalAudit.purgeAfter, at))
        .returning({ id: operationalAudit.id });
      return {
        tombstones: tombstones.length,
        auditRecords: auditRecords.length,
      };
    },
  };
}

export type AccountDeletionRepository = ReturnType<
  typeof createAccountDeletionRepository
>;
