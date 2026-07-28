import { describe, expect, it, vi } from "vitest";

import {
  GoogleGoneError,
  createGoogleCalendarAuthAdapter,
} from "./google-adapter";
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

describe("refreshAccessToken", () => {
  it("exchanges a refresh token for a fresh access token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: "fresh-at", expires_in: 3600 }),
      );
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    const token = await adapter.refreshAccessToken({ refreshToken: "rt" });

    expect(token.accessToken).toBe("fresh-at");
    expect(token.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.body as URLSearchParams).get("grant_type")).toBe(
      "refresh_token",
    );
  });

  it("throws when the refresh fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 400 }));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await expect(
      adapter.refreshAccessToken({ refreshToken: "rt" }),
    ).rejects.toThrow(/refresh/);
  });
});

describe("listEvents", () => {
  it("requests expanded instances with deletions over the window and parses items", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: "evt-1",
            status: "confirmed",
            summary: "Standup",
            start: { dateTime: "2026-07-27T09:00:00-04:00" },
            end: { dateTime: "2026-07-27T09:30:00-04:00" },
          },
          { id: "evt-2", status: "cancelled" },
          { notAnEvent: true },
        ],
        nextPageToken: "page-2",
      }),
    );
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    const page = await adapter.listEvents({
      accessToken: "at",
      calendarId: "team@group.calendar.google.com",
      timeMin: "2026-06-27T00:00:00Z",
      timeMax: "2027-07-27T00:00:00Z",
    });

    expect(page.events).toHaveLength(2);
    expect(page.nextPageToken).toBe("page-2");
    expect(page.nextSyncToken).toBeNull();

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain("calendars/team%40group.calendar.google.com/events");
    expect(url).toContain("singleEvents=true");
    expect(url).toContain("showDeleted=true");
    expect(url).toContain("timeMin=");
  });

  it("returns the sync token on the final page", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], nextSyncToken: "sync-1" }));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    const page = await adapter.listEvents({
      accessToken: "at",
      calendarId: "primary@example.com",
      timeMin: "2026-06-27T00:00:00Z",
      timeMax: "2027-07-27T00:00:00Z",
    });

    expect(page.nextPageToken).toBeNull();
    expect(page.nextSyncToken).toBe("sync-1");
  });

  it("raises a typed error on 410 Gone", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 410 }));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await expect(
      adapter.listEvents({
        accessToken: "at",
        calendarId: "primary@example.com",
        timeMin: "2026-06-27T00:00:00Z",
        timeMax: "2027-07-27T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(GoogleGoneError);
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

const writeBody = {
  summary: "Standup",
  start: { dateTime: "2026-07-27T13:00:00.000Z", timeZone: "America/New_York" },
  end: { dateTime: "2026-07-27T13:30:00.000Z", timeZone: "America/New_York" },
  status: "confirmed" as const,
};

describe("insertEvent", () => {
  it("posts the write body to the calendar and returns the assigned id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: "g-created-1" }, 200));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    const result = await adapter.insertEvent({
      accessToken: "at",
      calendarId: "team@group.calendar.google.com",
      body: writeBody,
    });

    expect(result.googleEventId).toBe("g-created-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/team%40group.calendar.google.com/events",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(writeBody);
  });

  it("throws when Google omits the created id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 200));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await expect(
      adapter.insertEvent({
        accessToken: "at",
        calendarId: "c",
        body: writeBody,
      }),
    ).rejects.toThrow(/missing an id/);
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await expect(
      adapter.insertEvent({
        accessToken: "at",
        calendarId: "c",
        body: writeBody,
      }),
    ).rejects.toThrow(/insert failed \(500\)/);
  });
});

describe("patchEvent", () => {
  it("patches the identified event with the write body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: "g-1" }, 200));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await adapter.patchEvent({
      accessToken: "at",
      calendarId: "primary@example.com",
      googleEventId: "g-1",
      body: writeBody,
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary%40example.com/events/g-1",
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual(writeBody);
  });

  it("treats a 410 as a benign no-op", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 410 }));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await expect(
      adapter.patchEvent({
        accessToken: "at",
        calendarId: "c",
        googleEventId: "g-1",
        body: writeBody,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws on a non-2xx response other than 404/410", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await expect(
      adapter.patchEvent({
        accessToken: "at",
        calendarId: "c",
        googleEventId: "g-1",
        body: writeBody,
      }),
    ).rejects.toThrow(/patch failed \(500\)/);
  });
});

describe("deleteEvent", () => {
  it("deletes the identified event", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await adapter.deleteEvent({
      accessToken: "at",
      calendarId: "primary@example.com",
      googleEventId: "g-1",
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary%40example.com/events/g-1",
    );
    expect(init.method).toBe("DELETE");
  });

  it("resolves when the event is already gone (410)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 410 }));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await expect(
      adapter.deleteEvent({
        accessToken: "at",
        calendarId: "c",
        googleEventId: "g-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("throws on a non-2xx response other than 404/410", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }));
    const adapter = createGoogleCalendarAuthAdapter(config, fetchImpl);

    await expect(
      adapter.deleteEvent({
        accessToken: "at",
        calendarId: "c",
        googleEventId: "g-1",
      }),
    ).rejects.toThrow(/delete failed \(500\)/);
  });
});
