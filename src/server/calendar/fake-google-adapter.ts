import type { AvailableCalendar } from "@/domain/calendar/connection";
import type { GoogleEventResource } from "@/domain/calendar/import";

import {
  GoogleGoneError,
  type GoogleCalendarAuthAdapter,
  type GoogleTokenGrant,
  type GoogleWatchChannel,
  type GoogleWatchRequest,
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
  /**
   * Seeded incremental changes per calendar id, returned by `listEventChanges`
   * with the same pagination rules as `events`.
   */
  changes?: Record<string, GoogleEventResource[]>;
  /** Calendar ids for which `listEventChanges` throws {@link GoogleGoneError}. */
  changesGone?: string[];
  /** The sync token handed back on a calendar's final change page. */
  nextSyncTokenFor?: (calendarId: string) => string;
  /** Expiry the fake watch reports; defaults to a far-future instant. */
  watchExpiration?: Date;
}

/** One recorded `listEvents` call, so tests can assert the requested window. */
export interface RecordedEventsRequest {
  calendarId: string;
  timeMin: string;
  timeMax: string;
  pageToken?: string;
}

/** One recorded `listEventChanges` call, so tests can assert the cursor used. */
export interface RecordedChangesRequest {
  calendarId: string;
  syncToken: string;
  pageToken?: string;
}

export interface FakeGoogleAdapter extends GoogleCalendarAuthAdapter {
  readonly revokedTokens: string[];
  readonly authorizationStates: string[];
  readonly refreshedTokens: string[];
  readonly eventsRequests: RecordedEventsRequest[];
  readonly changesRequests: RecordedChangesRequest[];
  readonly watchRequests: GoogleWatchRequest[];
  readonly stoppedChannels: { channelId: string; resourceId: string }[];
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
  const changesRequests: RecordedChangesRequest[] = [];
  const watchRequests: GoogleWatchRequest[] = [];
  const stoppedChannels: { channelId: string; resourceId: string }[] = [];

  /** Slices a seeded event list into one page, mirroring `listEvents`. */
  function pageOf(all: GoogleEventResource[], pageToken?: string) {
    const pageSize = options.eventsPageSize ?? Math.max(all.length, 1);
    const offset = pageToken ? Number.parseInt(pageToken, 10) : 0;
    const slice = all.slice(offset, offset + pageSize);
    const nextOffset = offset + pageSize;
    const hasMore = nextOffset < all.length;
    return {
      events: slice.map((event) => ({ ...event })),
      nextPageToken: hasMore ? String(nextOffset) : null,
      hasMore,
    };
  }

  return {
    revokedTokens,
    authorizationStates,
    refreshedTokens,
    eventsRequests,
    changesRequests,
    watchRequests,
    stoppedChannels,

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

      const { events, nextPageToken, hasMore } = pageOf(
        options.events?.[calendarId] ?? [],
        pageToken,
      );
      return {
        events,
        nextPageToken,
        nextSyncToken: hasMore
          ? null
          : (options.syncTokenFor?.(calendarId) ?? `sync-${calendarId}`),
      };
    },

    async listEventChanges({ calendarId, syncToken, pageToken }) {
      changesRequests.push({ calendarId, syncToken, pageToken });

      if (options.changesGone?.includes(calendarId)) {
        throw new GoogleGoneError(calendarId);
      }

      const { events, nextPageToken, hasMore } = pageOf(
        options.changes?.[calendarId] ?? [],
        pageToken,
      );
      return {
        events,
        nextPageToken,
        nextSyncToken: hasMore
          ? null
          : (options.nextSyncTokenFor?.(calendarId) ??
            `sync-next-${calendarId}`),
      };
    },

    async watchEvents(input): Promise<GoogleWatchChannel> {
      watchRequests.push({ ...input });
      return {
        channelId: input.channelId,
        resourceId: `resource-for-${input.channelId}`,
        expiration:
          options.watchExpiration ?? new Date("2099-01-01T00:00:00.000Z"),
      };
    },

    async stopChannel({ channelId, resourceId }) {
      stoppedChannels.push({ channelId, resourceId });
    },

    async revoke({ token }) {
      revokedTokens.push(token);
    },
  };
}
