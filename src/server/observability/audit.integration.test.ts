import { eq, inArray, lte } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseConnection } from "@/server/db/client";
import { operationalAudit } from "@/server/db/schema";

import {
  createOperationalAuditRecorder,
  pseudonymousAccountReference,
} from "./audit";

const DATABASE_URL = process.env.DATABASE_URL;
const CORRELATION_IDS = ["cor_audit_sync", "cor_audit_export"];
const connection = DATABASE_URL
  ? createDatabaseConnection(DATABASE_URL)
  : undefined;

describe.skipIf(!connection)(
  "Operational audit recorder PostgreSQL integration",
  () => {
    const db = () => connection!.database;
    const recorder = () => createOperationalAuditRecorder(db());

    async function clean() {
      await db()
        .delete(operationalAudit)
        .where(inArray(operationalAudit.correlationId, CORRELATION_IDS));
    }

    beforeEach(clean);
    afterAll(async () => {
      await clean();
      await connection?.close();
    });

    it("appends a metadata-only record keyed by a pseudonym, not the account id", async () => {
      await recorder().record({
        userId: "audit-user-1",
        action: "calendar.incremental_synced",
        target: "aaaaaaaa-0000-4000-8000-000000000001",
        outcome: "success",
        correlationId: "cor_audit_sync",
      });

      const [row] = await db()
        .select()
        .from(operationalAudit)
        .where(eq(operationalAudit.correlationId, "cor_audit_sync"));

      expect(row.accountReference).toBe(
        pseudonymousAccountReference("audit-user-1"),
      );
      expect(row.accountReference).not.toBe("audit-user-1");
      expect(row.action).toBe("calendar.incremental_synced");
      expect(row.opaqueTarget).toBe("aaaaaaaa-0000-4000-8000-000000000001");
      expect(row.outcome).toBe("success");
      // A 90-day purge window is stamped so visibility is not indefinite.
      const ttlDays =
        (row.purgeAfter.getTime() - row.occurredAt.getTime()) /
        (24 * 60 * 60 * 1000);
      expect(Math.round(ttlDays)).toBe(90);
    });

    it("records a safe failure code for a terminal export failure", async () => {
      await recorder().record({
        userId: "audit-user-2",
        action: "account.data_exported",
        target: "aaaaaaaa-0000-4000-8000-000000000002",
        outcome: "failure",
        safeCode: "account_missing",
        correlationId: "cor_audit_export",
      });

      const [row] = await db()
        .select()
        .from(operationalAudit)
        .where(eq(operationalAudit.correlationId, "cor_audit_export"));

      expect(row.outcome).toBe("failure");
      expect(row.safeCode).toBe("account_missing");
    });

    it("is purged once its retention window has elapsed", async () => {
      await recorder().record({
        userId: "audit-user-1",
        action: "calendar.incremental_synced",
        target: "aaaaaaaa-0000-4000-8000-000000000003",
        outcome: "success",
        correlationId: "cor_audit_sync",
        at: new Date("2020-01-01T00:00:00.000Z"),
      });

      const purged = await db()
        .delete(operationalAudit)
        .where(lte(operationalAudit.purgeAfter, new Date()))
        .returning({ id: operationalAudit.id });

      expect(purged.length).toBeGreaterThanOrEqual(1);
    });
  },
);
