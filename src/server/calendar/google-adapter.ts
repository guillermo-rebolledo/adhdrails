import {
  type AvailableCalendar,
  CALENDAR_SCOPES,
  availableCalendarSchema,
} from "@/domain/calendar/connection";
import {
  type GoogleEventResource,
  googleEventResourceSchema,
} from "@/domain/calendar/import";

import type { GoogleOAuthConfig } from "./env";

/**
 * The Google Calendar boundary, expressed as an interface so every use case is
 * exercised against a fake in tests and the real HTTP implementation only in
 * production. It owns the incremental-authorization handshake (build a consent
 * URL, exchange the code, revoke a grant), the calendar-list read the connect
 * flow needs, and — for the import (MEM-40) — refreshing an access token from a
 * stored refresh token and paginating a calendar's events over a window.
 */
export interface GoogleCalendarAuthAdapter {
  buildAuthorizationUrl(input: { state: string; loginHint?: string }): string;
  exchangeCode(input: { code: string }): Promise<GoogleTokenGrant>;
  listCalendars(input: { accessToken: string }): Promise<AvailableCalendar[]>;
  refreshAccessToken(input: {
    refreshToken: string;
  }): Promise<GoogleAccessToken>;
  listEvents(input: GoogleEventsQuery): Promise<GoogleEventsPage>;
  /**
   * Reads the changes since a stored sync token — the incremental counterpart to
   * {@link listEvents}. A `410 Gone` (the sync horizon expired) surfaces as
   * {@link GoogleGoneError} so the caller can reset the calendar and resync.
   */
  listEventChanges(input: GoogleEventChangesQuery): Promise<GoogleEventsPage>;
  /** Opens a push-notification channel on a calendar's events resource. */
  watchEvents(input: GoogleWatchRequest): Promise<GoogleWatchChannel>;
  /** Closes a previously opened notification channel. Best-effort. */
  stopChannel(input: {
    accessToken: string;
    channelId: string;
    resourceId: string;
  }): Promise<void>;
  revoke(input: { token: string }): Promise<void>;
}

/** The tokens returned by a successful authorization-code exchange. */
export interface GoogleTokenGrant {
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  scope: string;
  googleAccountId: string | null;
}

/** A short-lived access token minted from a stored refresh token. */
export interface GoogleAccessToken {
  accessToken: string;
  accessTokenExpiresAt: Date;
}

/** One paginated read of a calendar's events over the mirror window. */
export interface GoogleEventsQuery {
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  pageToken?: string;
}

/** One paginated read of the changes since a stored sync token. */
export interface GoogleEventChangesQuery {
  accessToken: string;
  calendarId: string;
  syncToken: string;
  pageToken?: string;
}

/** What Rails needs to open a push-notification channel on a calendar. */
export interface GoogleWatchRequest {
  accessToken: string;
  calendarId: string;
  /** The channel id Rails generated; echoed back on every notification. */
  channelId: string;
  /** The opaque verification token a notification must present. */
  token: string;
  /** The absolute HTTPS webhook URL Google should POST notifications to. */
  address: string;
  /** Requested channel lifetime; Google may shorten it. */
  ttlSeconds?: number;
}

/** The channel Google opened, as Rails stores it. */
export interface GoogleWatchChannel {
  channelId: string;
  resourceId: string;
  /** When Google will stop delivering, or null if it did not say. */
  expiration: Date | null;
}

/**
 * One page of a calendar's events. `nextPageToken` drives pagination; when it is
 * null the final page carries Google's `nextSyncToken`, which the import stores
 * so the incremental sync (MEM-41) can resume from this exact point.
 */
export interface GoogleEventsPage {
  events: GoogleEventResource[];
  nextPageToken: string | null;
  nextSyncToken: string | null;
}

/** Rows requested per events page; Google caps this at 2500. */
const EVENTS_PAGE_SIZE = 250;

/**
 * Raised when Google answers an events read with `410 Gone`: the requested sync
 * horizon has expired. The import treats it as a signal to clear the affected
 * calendar's cursor and mirror and perform a bounded full resynchronization.
 */
export class GoogleGoneError extends Error {
  constructor(readonly calendarId: string) {
    super(`Google calendar sync horizon is gone (${calendarId}).`);
    this.name = "GoogleGoneError";
  }
}

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const CALENDAR_LIST_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const CALENDAR_EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars";
const CHANNELS_STOP_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/channels/stop";

/**
 * Fetches and parses one `events.list` page, shared by the windowed import and
 * the incremental change read. A `410 Gone` — the requested horizon or sync
 * token has expired — surfaces as {@link GoogleGoneError}; unparseable items are
 * skipped defensively rather than aborting the page.
 */
async function readEventsPage(
  fetchImpl: typeof fetch,
  accessToken: string,
  calendarId: string,
  params: URLSearchParams,
): Promise<GoogleEventsPage> {
  const response = await fetchImpl(
    `${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );

  if (response.status === 410) {
    // The sync horizon is gone; the caller resets this calendar's cursor.
    throw new GoogleGoneError(calendarId);
  }
  if (!response.ok) {
    throw new Error(`Google events list failed (${response.status}).`);
  }

  const body = (await response.json()) as {
    items?: unknown[];
    nextPageToken?: string;
    nextSyncToken?: string;
  };

  const events = (body.items ?? []).flatMap((item) => {
    const parsed = googleEventResourceSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

  return {
    events,
    nextPageToken: body.nextPageToken ?? null,
    nextSyncToken: body.nextSyncToken ?? null,
  };
}

interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  accessRole: string;
  timeZone?: string;
  primary?: boolean;
}

function normalizeAccessRole(role: string): AvailableCalendar["accessRole"] {
  switch (role) {
    case "owner":
    case "writer":
    case "reader":
    case "freeBusyReader":
      return role;
    default:
      // An unrecognized role is treated as the least-privileged so it can never
      // accidentally become a write destination.
      return "freeBusyReader";
  }
}

/**
 * The production adapter. It talks to Google's OAuth and Calendar endpoints over
 * `fetch`, requesting offline access with forced consent so a refresh token is
 * always returned on the incremental grant.
 */
export function createGoogleCalendarAuthAdapter(
  config: GoogleOAuthConfig,
  fetchImpl: typeof fetch = fetch,
): GoogleCalendarAuthAdapter {
  return {
    buildAuthorizationUrl({ state, loginHint }) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: CALENDAR_SCOPES.join(" "),
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
        state,
      });
      if (loginHint) {
        params.set("login_hint", loginHint);
      }
      return `${AUTH_ENDPOINT}?${params.toString()}`;
    },

    async exchangeCode({ code }) {
      const response = await fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!response.ok) {
        throw new Error(`Google token exchange failed (${response.status}).`);
      }

      const body = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        scope: string;
        id_token?: string;
      };

      if (!body.refresh_token) {
        // Without offline access there is nothing durable to store; treat it as
        // a failed grant rather than a half-connected state.
        throw new Error("Google did not return a refresh token.");
      }

      return {
        refreshToken: body.refresh_token,
        accessToken: body.access_token,
        accessTokenExpiresAt: new Date(Date.now() + body.expires_in * 1000),
        scope: body.scope,
        googleAccountId: subjectFromIdToken(body.id_token),
      };
    },

    async refreshAccessToken({ refreshToken }) {
      const response = await fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
        }),
      });

      if (!response.ok) {
        throw new Error(`Google token refresh failed (${response.status}).`);
      }

      const body = (await response.json()) as {
        access_token: string;
        expires_in: number;
      };

      return {
        accessToken: body.access_token,
        accessTokenExpiresAt: new Date(Date.now() + body.expires_in * 1000),
      };
    },

    async listEvents({ accessToken, calendarId, timeMin, timeMax, pageToken }) {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        // Expand recurring series into individual instances so each occurrence
        // mirrors faithfully; include cancellations so deletions are observed.
        singleEvents: "true",
        showDeleted: "true",
        maxResults: String(EVENTS_PAGE_SIZE),
      });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      return readEventsPage(fetchImpl, accessToken, calendarId, params);
    },

    async listEventChanges({ accessToken, calendarId, syncToken, pageToken }) {
      // An incremental read passes only the sync token — never timeMin/timeMax,
      // which Google rejects alongside a sync token. `singleEvents`/`showDeleted`
      // must match the initial import so instances and cancellations keep
      // arriving; the cursor advances on the final page's `nextSyncToken`.
      const params = new URLSearchParams({
        syncToken,
        singleEvents: "true",
        showDeleted: "true",
        maxResults: String(EVENTS_PAGE_SIZE),
      });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      return readEventsPage(fetchImpl, accessToken, calendarId, params);
    },

    async watchEvents({
      accessToken,
      calendarId,
      channelId,
      token,
      address,
      ttlSeconds,
    }) {
      const response = await fetchImpl(
        `${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events/watch`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            id: channelId,
            type: "web_hook",
            address,
            token,
            ...(ttlSeconds
              ? { params: { ttl: String(ttlSeconds) } }
              : undefined),
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Google events watch failed (${response.status}).`);
      }

      const body = (await response.json()) as {
        resourceId?: string;
        expiration?: string;
      };
      if (!body.resourceId) {
        throw new Error("Google watch response is missing a resource id.");
      }

      const expirationMs = body.expiration
        ? Number.parseInt(body.expiration, 10)
        : Number.NaN;
      return {
        channelId,
        resourceId: body.resourceId,
        expiration: Number.isFinite(expirationMs)
          ? new Date(expirationMs)
          : null,
      };
    },

    async stopChannel({ accessToken, channelId, resourceId }) {
      // Best-effort: an already-expired channel still leaves Rails free to drop
      // its stored watch, so a non-2xx response is swallowed.
      await fetchImpl(CHANNELS_STOP_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: channelId, resourceId }),
      }).catch(() => undefined);
    },

    async listCalendars({ accessToken }) {
      const response = await fetchImpl(
        `${CALENDAR_LIST_ENDPOINT}?minAccessRole=freeBusyReader&showHidden=false`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );

      if (!response.ok) {
        throw new Error(`Google calendar list failed (${response.status}).`);
      }

      const body = (await response.json()) as {
        items?: GoogleCalendarListEntry[];
      };

      return (body.items ?? []).map((entry) =>
        availableCalendarSchema.parse({
          googleCalendarId: entry.id,
          summary: entry.summaryOverride ?? entry.summary ?? entry.id,
          accessRole: normalizeAccessRole(entry.accessRole),
          timeZone: entry.timeZone ?? null,
          primary: entry.primary === true,
        }),
      );
    },

    async revoke({ token }) {
      // Revocation is best-effort: an already-invalid token still leaves Rails
      // free to drop its local connection, so a non-2xx response is swallowed.
      await fetchImpl(REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }).catch(() => undefined);
    },
  };
}

/** Reads the `sub` claim from a Google ID token without verifying it. */
function subjectFromIdToken(idToken?: string): string | null {
  if (!idToken) {
    return null;
  }
  try {
    const [, payload] = idToken.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sub?: string };
    return decoded.sub ?? null;
  } catch {
    return null;
  }
}
