import { getDatabase } from "@/server/db/connection";
import { createEventRepository } from "@/server/event/repository";

import { readCalendarTokenKeyring, readGoogleOAuthConfig } from "./env";
import {
  type CalendarImportService,
  createCalendarImportService,
} from "./import-service";
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
import { createTokenCipher } from "./token-cipher";

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
