import type { AvailableCalendar } from "@/domain/calendar/connection";
import type { GoogleEventResource } from "@/domain/calendar/import";

import type {
  GoogleCalendarAuthAdapter,
  GoogleTokenGrant,
} from "./google-adapter";

export interface FakeGoogleAdapterOptions {
  calendars?: AvailableCalendar[];
  grant?: Partial<GoogleTokenGrant>;
  /** When set, `exchangeCode` rejects with this to simulate a failed grant. */
  exchangeError?: Error;
  /** Seeded events per calendar id, returned by `listEvents` with pagination. */
  events?: Record<string, GoogleEventResource[]>;
  /** How many events `listEvents` returns per page (drives pagination). */
  eventsPageSize?: number;
  /** The sync token handed back on a calendar's final events page. */
  syncTokenFor?: (calendarId: string) => string;
}

/** One recorded `listEvents` call, so tests can assert the requested window. */
export interface RecordedEventsRequest {
  calendarId: string;
  timeMin: string;
  timeMax: string;
  pageToken?: string;
}

export interface FakeGoogleAdapter extends GoogleCalendarAuthAdapter {
  readonly revokedTokens: string[];
  readonly authorizationStates: string[];
  readonly refreshedTokens: string[];
  readonly eventsRequests: RecordedEventsRequest[];
}

const DEFAULT_CALENDARS: AvailableCalendar[] = [
  {
    googleCalendarId: "primary@example.com",
    summary: "Personal",
    accessRole: "owner",
    timeZone: "America/New_York",
    primary: true,
  },
  {
    googleCalendarId: "team@group.calendar.google.com",
    summary: "Team",
    accessRole: "writer",
    timeZone: "America/New_York",
    primary: false,
  },
  {
    googleCalendarId: "holidays@group.v.calendar.google.com",
    summary: "Holidays",
    accessRole: "reader",
    timeZone: null,
    primary: false,
  },
];

/**
 * An in-memory stand-in for {@link GoogleCalendarAuthAdapter}. It lets tests and
 * the test-only connect route drive the full connect/configure/disconnect flow
 * deterministically without a live Google grant, while exercising the same
 * service and repository code paths as production.
 */
export function createFakeGoogleAdapter(
  options: FakeGoogleAdapterOptions = {},
): FakeGoogleAdapter {
  const calendars = options.calendars ?? DEFAULT_CALENDARS;
  const revokedTokens: string[] = [];
  const authorizationStates: string[] = [];
  const refreshedTokens: string[] = [];
  const eventsRequests: RecordedEventsRequest[] = [];

  return {
    revokedTokens,
    authorizationStates,
    refreshedTokens,
    eventsRequests,

    buildAuthorizationUrl({ state }) {
      authorizationStates.push(state);
      return `https://fake-google.test/consent?state=${encodeURIComponent(state)}`;
    },

    async exchangeCode({ code }): Promise<GoogleTokenGrant> {
      if (options.exchangeError) {
        throw options.exchangeError;
      }
      return {
        refreshToken: `refresh-for-${code}`,
        accessToken: `access-for-${code}`,
        accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
        scope:
          "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
        googleAccountId: "google-account-1",
        ...options.grant,
      };
    },

    async listCalendars() {
      return calendars.map((calendar) => ({ ...calendar }));
    },

    async refreshAccessToken({ refreshToken }) {
      refreshedTokens.push(refreshToken);
      return {
        accessToken: `access-refreshed-for-${refreshToken}`,
        accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      };
    },

    async listEvents({ calendarId, timeMin, timeMax, pageToken }) {
      eventsRequests.push({ calendarId, timeMin, timeMax, pageToken });

      const all = options.events?.[calendarId] ?? [];
      const pageSize = options.eventsPageSize ?? Math.max(all.length, 1);
      const offset = pageToken ? Number.parseInt(pageToken, 10) : 0;
      const slice = all.slice(offset, offset + pageSize);
      const nextOffset = offset + pageSize;
      const hasMore = nextOffset < all.length;

      return {
        events: slice.map((event) => ({ ...event })),
        nextPageToken: hasMore ? String(nextOffset) : null,
        nextSyncToken: hasMore
          ? null
          : (options.syncTokenFor?.(calendarId) ?? `sync-${calendarId}`),
      };
    },

    async revoke({ token }) {
      revokedTokens.push(token);
    },
  };
}
