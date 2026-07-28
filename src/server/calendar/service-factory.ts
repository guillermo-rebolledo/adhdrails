import { inngest } from "@/server/inngest/client";
import { getDatabase } from "@/server/db/connection";
import { createEventRepository } from "@/server/event/repository";

import {
  readCalendarTokenKeyring,
  readCalendarWebhookConfig,
  readGoogleOAuthConfig,
} from "./env";
import {
  type CalendarImportService,
  createCalendarImportService,
} from "./import-service";
import {
  createIncrementalSyncService,
  type IncrementalSyncService,
} from "./incremental-sync-service";
import {
  createFakeGoogleAdapter,
  type FakeGoogleAdapter,
} from "./fake-google-adapter";
import {
  createGoogleCalendarAuthAdapter,
  type GoogleCalendarAuthAdapter,
} from "./google-adapter";
import { createCalendarRepository } from "./repository";
import { type CalendarService, createCalendarService } from "./service";
import {
  createEventSyncDispatcher,
  createRecordingSyncDispatcher,
  type SyncJobDispatcher,
} from "./sync-dispatcher";
import {
  type CalendarSyncJobRepository,
  createCalendarSyncJobRepository,
} from "./sync-job-repository";
import { createTokenCipher } from "./token-cipher";
import {
  type CalendarWatchService,
  createCalendarWatchService,
} from "./watch-service";
import {
  type CalendarWebhookService,
  createCalendarWebhookService,
} from "./webhook-service";

/**
 * Returns the Google adapter for the current runtime. Test runs (`APP_ENV=test`)
 * use the in-memory fake so Playwright can drive the whole connect/configure/
 * disconnect flow deterministically against the same service and repository code
 * paths; every other runtime uses the real HTTP adapter. The fake is a process
 * singleton so a test can inspect the states/tokens it recorded.
 */
let fakeAdapter: FakeGoogleAdapter | null = null;

function resolveAdapter(): GoogleCalendarAuthAdapter {
  if (process.env.APP_ENV === "test") {
    fakeAdapter ??= createFakeGoogleAdapter();
    return fakeAdapter;
  }
  return createGoogleCalendarAuthAdapter(readGoogleOAuthConfig());
}

/**
 * The job dispatcher for the current runtime. Test runs record dispatches to a
 * process singleton so the webhook route is driven deterministically without an
 * Inngest dev server; every other runtime enqueues real Inngest events. The
 * durable incremental sync itself is exercised directly in unit and integration
 * tests, so a recording dispatcher in test loses no coverage.
 */
let recordingDispatcher: ReturnType<
  typeof createRecordingSyncDispatcher
> | null = null;

function resolveDispatcher(): SyncJobDispatcher {
  if (process.env.APP_ENV === "test") {
    recordingDispatcher ??= createRecordingSyncDispatcher();
    return recordingDispatcher;
  }
  return createEventSyncDispatcher(inngest);
}

/** The job dispatcher, for the scheduled outbox drain to redeliver pending work. */
export function getCalendarSyncDispatcher(): SyncJobDispatcher {
  return resolveDispatcher();
}

/** Builds the request-time Calendar service with real (or test) dependencies. */
export function getCalendarService(): CalendarService {
  return createCalendarService({
    repository: createCalendarRepository(getDatabase()),
    adapter: resolveAdapter(),
    cipher: createTokenCipher(readCalendarTokenKeyring()),
  });
}

/** Builds the request-time Calendar import service (MEM-40 initial mirror). */
export function getCalendarImportService(): CalendarImportService {
  const database = getDatabase();
  return createCalendarImportService({
    calendarRepository: createCalendarRepository(database),
    eventRepository: createEventRepository(database),
    adapter: resolveAdapter(),
    cipher: createTokenCipher(readCalendarTokenKeyring()),
  });
}

/** Builds the incremental sync service the Inngest function runs (MEM-41). */
export function getIncrementalSyncService(): IncrementalSyncService {
  const database = getDatabase();
  return createIncrementalSyncService({
    calendarRepository: createCalendarRepository(database),
    eventRepository: createEventRepository(database),
    adapter: resolveAdapter(),
    cipher: createTokenCipher(readCalendarTokenKeyring()),
  });
}

/** Builds the webhook service that verifies and enqueues notifications. */
export function getCalendarWebhookService(): CalendarWebhookService {
  const database = getDatabase();
  return createCalendarWebhookService({
    calendarRepository: createCalendarRepository(database),
    syncJobRepository: createCalendarSyncJobRepository(database),
    dispatcher: resolveDispatcher(),
  });
}

/** The outbox repository, for the Inngest function to advance job lifecycle. */
export function getCalendarSyncJobRepository(): CalendarSyncJobRepository {
  return createCalendarSyncJobRepository(getDatabase());
}

/** Builds the watch service that opens and renews push-notification channels. */
export function getCalendarWatchService(): CalendarWatchService {
  return createCalendarWatchService({
    calendarRepository: createCalendarRepository(getDatabase()),
    adapter: resolveAdapter(),
    cipher: createTokenCipher(readCalendarTokenKeyring()),
    config: readCalendarWebhookConfig(),
  });
}
