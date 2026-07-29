import { createHmac } from "node:crypto";

import {
  OPERATIONAL_AUDIT_TTL_MS,
  retentionDeadline,
} from "@/domain/account/deletion";
import { getDatabase } from "@/server/db/connection";
import type { Database } from "@/server/db/connection";
import { operationalAudit } from "@/server/db/schema";

/**
 * Append-only, metadata-only operational audit records for the durable
 * workflows a support operator must be able to diagnose — Calendar
 * synchronization, data export, and account deletion. A record never holds Task
 * or Thought content, Calendar payloads, tokens, exported data, provider ids, or
 * a raw account id: the account is referenced only by an opaque pseudonym, the
 * target only by an opaque id, and failures only by a safe code. Every row
 * carries a fixed 90-day purge time so operational visibility never becomes
 * indefinite tracking.
 */

function pseudonymSecret(): string {
  // A stable per-environment secret so an account's records group together for
  // support without the raw account id ever being stored.
  const configured = process.env.OPERATIONAL_AUDIT_PSEUDONYM_SECRET?.trim();
  if (configured) {
    return configured;
  }
  // In production a real secret is mandatory: falling back to a public, in-repo
  // value would make the deterministic HMAC reversible by anyone. Local and test
  // runtimes use a deterministic development value so derivation stays testable.
  if (process.env.VERCEL_ENV === "production") {
    throw new Error(
      "OPERATIONAL_AUDIT_PSEUDONYM_SECRET is required in production.",
    );
  }
  return "rails-development-operational-audit-pseudonym";
}

/**
 * Derives the opaque account reference for audit records from an account id. The
 * result is a stable UUID-shaped HMAC: deterministic, so a support operator can
 * group one account's records, yet non-reversible without both the account id
 * and the secret — and the audit table never stores the account id, so a deleted
 * account's records cannot be joined back to identity. Pure given the secret.
 */
export function pseudonymousAccountReference(
  userId: string,
  secret: string = pseudonymSecret(),
): string {
  const hex = createHmac("sha256", secret).update(userId).digest("hex");
  // Shape 32 hex characters into a canonical version-4-style UUID string. The
  // exact bits are irrelevant; a valid UUID is what the audit column stores.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export interface OperationalAuditRowInput {
  /**
   * The opaque, non-identifying account pseudonym. Sync and export derive it
   * deterministically from the account id (so a support operator can group an
   * account's records); the deletion workflow supplies its own random pseudonym
   * so a finalized account is deliberately unlinkable.
   */
  accountReference: string;
  action: string;
  /** An opaque identifier for the affected resource (e.g. the job id). */
  target: string;
  outcome: string;
  safeCode?: string;
  correlationId: string;
  at?: Date;
}

/**
 * Builds one `operational_audit` row and stamps the fixed 90-day purge time.
 * This is the single row-assembly used by every workflow (sync, export,
 * deletion), so a metadata-only, redacted record is produced identically
 * regardless of how the caller chose its account pseudonym.
 */
export function operationalAuditRow(input: OperationalAuditRowInput) {
  const at = input.at ?? new Date();
  return {
    id: crypto.randomUUID(),
    accountReference: input.accountReference,
    action: input.action,
    opaqueTarget: input.target,
    outcome: input.outcome,
    safeCode: input.safeCode ?? null,
    correlationId: input.correlationId,
    occurredAt: at,
    purgeAfter: retentionDeadline(at, OPERATIONAL_AUDIT_TTL_MS),
  };
}

export interface OperationalAuditInput {
  /** The raw account id; hashed to a pseudonym here and never stored raw. */
  userId: string;
  action: string;
  /** An opaque identifier for the affected resource (e.g. the job id). */
  target: string;
  outcome: string;
  safeCode?: string;
  correlationId: string;
  at?: Date;
}

/**
 * Builds an audit row from a raw account id by hashing it to the deterministic
 * pseudonym first. The sync and export workflows use this variant.
 */
export function operationalAuditValues(input: OperationalAuditInput) {
  const { userId, ...rest } = input;
  return operationalAuditRow({
    ...rest,
    accountReference: pseudonymousAccountReference(userId),
  });
}

export interface OperationalAuditRecorder {
  record: (input: OperationalAuditInput) => Promise<void>;
}

/** A recorder that appends one metadata-only audit row per call. */
export function createOperationalAuditRecorder(
  database: Database,
): OperationalAuditRecorder {
  return {
    async record(input) {
      await database
        .insert(operationalAudit)
        .values(operationalAuditValues(input));
    },
  };
}

/** The database-backed recorder used by the durable Inngest workflows. */
export function getOperationalAuditRecorder(): OperationalAuditRecorder {
  return createOperationalAuditRecorder(getDatabase());
}
