import {
  dataExportFilename,
  isDataExportExpired,
  type DataExportStatusResponse,
} from "@/domain/account/data-export";

import type { DataExportDispatcher } from "./data-export-dispatcher";
import type { DataExportRepository } from "./data-export-repository";
import { serializeDataExportStatus } from "./data-export-http";

export interface DataExportServiceDependencies {
  repository: DataExportRepository;
  dispatcher: DataExportDispatcher;
  /** Injectable clock so status expiry is deterministic in tests. */
  now?: () => Date;
}

export type RequestExportResult = {
  created: boolean;
  status: DataExportStatusResponse;
};

export type DownloadExportResult =
  | { ok: true; payload: string; filename: string }
  | { ok: false; reason: "not_found" | "expired" };

/**
 * Owns the data-export use cases (MEM-48): request an export, report its status,
 * and hand back a finished archive. Requesting is idempotent while one is in
 * flight (the repository re-arms rather than piling up) and dispatches the
 * durable job inline for immediacy; the scheduled drain is the backstop. The
 * service never blocks on generation — the route returns the pending status
 * immediately so the user keeps working.
 */
export function createDataExportService(deps: DataExportServiceDependencies) {
  const { repository, dispatcher, now = () => new Date() } = deps;

  return {
    async requestExport(userId: string): Promise<RequestExportResult> {
      const { created, record } = await repository.create(userId);

      if (created) {
        // Inline dispatch for immediacy; a failure here is caught so the request
        // still succeeds, and the scheduled drain redelivers the pending row.
        try {
          await dispatcher.dispatch({ jobId: record.id });
        } catch {
          // The durable pending row remains; the outbox drain will pick it up.
        }
      }

      return {
        created,
        status: serializeDataExportStatus(record, now()),
      };
    },

    async getStatus(userId: string): Promise<DataExportStatusResponse> {
      const record = await repository.getLatest(userId);
      return serializeDataExportStatus(record, now());
    },

    async getDownload(userId: string): Promise<DownloadExportResult> {
      const download = await repository.getLatestCompletedDownload(userId);
      if (!download) {
        return { ok: false, reason: "not_found" };
      }
      if (isDataExportExpired(download.expiresAt, now())) {
        return { ok: false, reason: "expired" };
      }

      return {
        ok: true,
        payload: download.payload,
        filename: dataExportFilename(download.completedAt),
      };
    },
  };
}

export type DataExportService = ReturnType<typeof createDataExportService>;
