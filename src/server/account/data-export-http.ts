import {
  dataExportStatusResponseSchema,
  isDataExportExpired,
  type DataExportStatusResponse,
} from "@/domain/account/data-export";

import type { DataExportRecord } from "./data-export-repository";

/**
 * Serializes the account's latest export into the status the Settings surface
 * renders. A null record is the `none` state (never requested). A `completed`
 * record whose window has closed is reported as `expired` even before cleanup
 * has run, so the UI never offers a download that would 410. The response is
 * re-validated against the shared contract before it leaves the server.
 */
export function serializeDataExportStatus(
  record: DataExportRecord | null,
  now: Date,
): DataExportStatusResponse {
  if (!record) {
    return dataExportStatusResponseSchema.parse({
      status: "none",
      requestedAt: null,
      completedAt: null,
      expiresAt: null,
      byteSize: null,
      errorCode: null,
    });
  }

  const expired =
    record.status === "completed" && isDataExportExpired(record.expiresAt, now);

  return dataExportStatusResponseSchema.parse({
    status: expired ? "expired" : record.status,
    requestedAt: record.requestedAt.toISOString(),
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    byteSize: record.byteSize,
    errorCode: record.lastErrorCode,
  });
}
