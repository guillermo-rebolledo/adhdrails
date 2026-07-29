import type {
  AccountDeletionStatusResponse,
  AccountDeletionStatus,
} from "@/domain/account/deletion";

import type { AccountDeletionRecord } from "./deletion-repository";

export function serializeAccountDeletionStatus(
  record: AccountDeletionRecord,
): AccountDeletionStatusResponse {
  return {
    id: record.id,
    status: record.status as AccountDeletionStatus,
    requestedAt: record.requestedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    errorCode: record.lastErrorCode,
  };
}
