import {
  type AvailableCalendar,
  CALENDAR_SCOPES,
  availableCalendarSchema,
} from "@/domain/calendar/connection";

import type { GoogleOAuthConfig } from "./env";

/**
 * The Google Calendar OAuth boundary, expressed as an interface so every use
 * case is exercised against a fake in tests and the real HTTP implementation
 * only in production. It owns the incremental-authorization handshake (build a
 * consent URL, exchange the code, revoke a grant) and the one read the connect
 * flow needs (list the account's calendars).
 */
export interface GoogleCalendarAuthAdapter {
  buildAuthorizationUrl(input: { state: string; loginHint?: string }): string;
  exchangeCode(input: { code: string }): Promise<GoogleTokenGrant>;
  listCalendars(input: { accessToken: string }): Promise<AvailableCalendar[]>;
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

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const CALENDAR_LIST_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";

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
