import { z } from "zod";

export const ACCOUNT_DELETION_CONFIRMATION = "DELETE MY ACCOUNT";
export const ACCOUNT_DELETION_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OPERATIONAL_AUDIT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const accountDeletionRequestSchema = z.object({
  confirmation: z.literal(ACCOUNT_DELETION_CONFIRMATION),
});

export type AccountDeletionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface AccountDeletionStatusResponse {
  id: string;
  status: AccountDeletionStatus;
  requestedAt: string;
  completedAt: string | null;
  errorCode: string | null;
}

export function retentionDeadline(at: Date, ttlMs: number): Date {
  return new Date(at.getTime() + ttlMs);
}
