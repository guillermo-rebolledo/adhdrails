import { describe, expect, it, vi } from "vitest";

import { createGoogleCalendarAuthAdapter } from "./google-adapter";
import type { GoogleOAuthConfig } from "./env";

const config: GoogleOAuthConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://rails.example/api/calendar/callback",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("buildAuthorizationUrl", () => {
  it("requests offline access with forced consent and the calendar scopes", () => {
    const adapter = createGoogleCalendarAuthAdapter(config, vi.fn());
    const url = new URL(adapter.buildAuthorizationUrl({ state: "state-123" }));

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("scope")).toContain("calendar.readonly");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
  });
});

describe("exchangeCode", () => {
  it("returns tokens and the account subject from the id token", async () => {
    const idToken = `header.${Buffer.from(
      JSON.stringify({ sub: "google-sub-1" }),
    ).toString("base64url")}.sig`;
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        scope: "scope",
        id_token: idToken,
      }),
    );
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    const grant = await adapter.exchangeCode({ code: "auth-code" });

    expect(grant.refreshToken).toBe("rt");
    expect(grant.googleAccountId).toBe("google-sub-1");
    expect(grant.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("throws when Google omits a refresh token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: "at", expires_in: 3600, scope: "scope" }),
      );
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await expect(adapter.exchangeCode({ code: "c" })).rejects.toThrow(
      /refresh token/,
    );
  });
});

describe("listCalendars", () => {
  it("maps calendar list entries and clamps unknown roles to freeBusyReader", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: "primary@example.com",
            summary: "Personal",
            accessRole: "owner",
            timeZone: "Europe/Madrid",
            primary: true,
          },
          {
            id: "weird",
            summary: "Weird",
            accessRole: "somethingElse",
          },
        ],
      }),
    );
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    const calendars = await adapter.listCalendars({ accessToken: "at" });

    expect(calendars[0]).toMatchObject({
      googleCalendarId: "primary@example.com",
      accessRole: "owner",
      primary: true,
    });
    expect(calendars[1]).toMatchObject({
      accessRole: "freeBusyReader",
      timeZone: null,
      primary: false,
    });
  });
});

describe("revoke", () => {
  it("posts the token and never throws on a failed revocation", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 400 }));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await expect(adapter.revoke({ token: "rt" })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
