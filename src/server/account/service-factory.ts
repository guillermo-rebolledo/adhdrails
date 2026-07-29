import { getDatabase } from "@/server/db/connection";
import { inngest } from "@/server/inngest/client";

import {
  createDataExportDispatcher,
  createRecordingDataExportDispatcher,
  type DataExportDispatcher,
} from "./data-export-dispatcher";
import {
  createDataExportRepository,
  type DataExportRepository,
} from "./data-export-repository";
import {
  createDataExportService,
  type DataExportService,
} from "./data-export-service";
import {
  createAccountDeletionDispatcher,
  createRecordingAccountDeletionDispatcher,
  type AccountDeletionDispatcher,
} from "./deletion-dispatcher";
import {
  createAccountDeletionRepository,
  type AccountDeletionRepository,
} from "./deletion-repository";
import {
  createAccountDeletionService,
  type AccountDeletionService,
} from "./deletion-service";

/**
 * The data-export dispatcher for the current runtime. Test runs record
 * dispatches to a process singleton so the request path is driven
 * deterministically without an Inngest dev server; every other runtime enqueues
 * real Inngest events. The exporter body is exercised directly in unit and
 * integration tests, so a recording dispatcher in test loses no coverage.
 */
let recordingDataExportDispatcher: ReturnType<
  typeof createRecordingDataExportDispatcher
> | null = null;
let recordingAccountDeletionDispatcher: ReturnType<
  typeof createRecordingAccountDeletionDispatcher
> | null = null;

function resolveDataExportDispatcher(): DataExportDispatcher {
  if (process.env.APP_ENV === "test") {
    recordingDataExportDispatcher ??= createRecordingDataExportDispatcher();
    return recordingDataExportDispatcher;
  }
  return createDataExportDispatcher(inngest);
}

/** The data-export dispatcher, for the scheduled drain to redeliver pending work. */
export function getDataExportDispatcher(): DataExportDispatcher {
  return resolveDataExportDispatcher();
}

/** The export repository, for the Inngest exporter and cleanup to advance jobs. */
export function getDataExportRepository(): DataExportRepository {
  return createDataExportRepository(getDatabase());
}

/** Builds the request-time data-export service with real (or test) dependencies. */
export function getDataExportService(): DataExportService {
  return createDataExportService({
    repository: getDataExportRepository(),
    dispatcher: resolveDataExportDispatcher(),
  });
}

function resolveAccountDeletionDispatcher(): AccountDeletionDispatcher {
  if (process.env.APP_ENV === "test") {
    recordingAccountDeletionDispatcher ??=
      createRecordingAccountDeletionDispatcher();
    return recordingAccountDeletionDispatcher;
  }
  return createAccountDeletionDispatcher(inngest);
}

export function getAccountDeletionDispatcher(): AccountDeletionDispatcher {
  return resolveAccountDeletionDispatcher();
}

export function getAccountDeletionRepository(): AccountDeletionRepository {
  return createAccountDeletionRepository(getDatabase());
}

export function getAccountDeletionService(): AccountDeletionService {
  return createAccountDeletionService({
    repository: getAccountDeletionRepository(),
    dispatcher: resolveAccountDeletionDispatcher(),
  });
}
