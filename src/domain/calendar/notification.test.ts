import { describe, expect, it } from "vitest";

import {
  WATCH_RENEWAL_LEAD_MS,
  channelTokenMatches,
  interpretCalendarNotification,
  type RawNotificationHeaders,
  watchNeedsRenewal,
} from "./notification";

function headers(
  overrides: Partial<RawNotificationHeaders> = {},
): RawNotificationHeaders {
  return {
    channelId: "chan-1",
    token: "secret-token",
    resourceId: "resource-1",
    resourceState: "exists",
    messageNumber: "7",
    ...overrides,
  };
}

describe("interpretCalendarNotification", () => {
  it("classifies the initial sync message as a handshake", () => {
    expect(
      interpretCalendarNotification(headers({ resourceState: "sync" })),
    ).toEqual({
      kind: "handshake",
      channelId: "chan-1",
      resourceId: "resource-1",
    });
  });

  it("classifies an exists notification as a routable change", () => {
    expect(interpretCalendarNotification(headers())).toEqual({
      kind: "change",
      channelId: "chan-1",
      token: "secret-token",
      resourceId: "resource-1",
      messageNumber: 7,
    });
  });

  it("treats not_exists like exists — the calendar changed, go resync", () => {
    const result = interpretCalendarNotification(
      headers({ resourceState: "not_exists" }),
    );
    expect(result).toMatchObject({ kind: "change", messageNumber: 7 });
  });

  it("is invalid when a required header is missing", () => {
    for (const missing of [
      { channelId: null },
      { resourceId: null },
      { resourceState: null },
    ] satisfies Partial<RawNotificationHeaders>[]) {
      expect(interpretCalendarNotification(headers(missing))).toEqual({
        kind: "invalid",
        reason: "missing_headers",
      });
    }
  });

  it("is invalid when the message number is missing or not a positive integer", () => {
    for (const bad of ["", "abc", "0", "-3"]) {
      expect(
        interpretCalendarNotification(headers({ messageNumber: bad })),
      ).toEqual({ kind: "invalid", reason: "bad_message_number" });
    }
  });

  it("ignores a well-formed notification whose state is unhandled", () => {
    expect(
      interpretCalendarNotification(headers({ resourceState: "something" })),
    ).toEqual({ kind: "ignore", reason: "unhandled_state:something" });
  });

  it("carries a null token through rather than failing verification here", () => {
    const result = interpretCalendarNotification(headers({ token: null }));
    expect(result).toMatchObject({ kind: "change", token: null });
  });
});

describe("channelTokenMatches", () => {
  it("matches identical tokens", () => {
    expect(channelTokenMatches("abc123", "abc123")).toBe(true);
  });

  it("rejects a mismatched, differently-sized, or absent token", () => {
    expect(channelTokenMatches("abc123", "abc124")).toBe(false);
    expect(channelTokenMatches("abc123", "abc1234")).toBe(false);
    expect(channelTokenMatches(null, "abc123")).toBe(false);
    expect(channelTokenMatches("abc123", null)).toBe(false);
    expect(channelTokenMatches("", "")).toBe(false);
  });
});

describe("watchNeedsRenewal", () => {
  const now = new Date("2026-07-28T00:00:00.000Z");

  it("renews when there is no recorded expiry", () => {
    expect(watchNeedsRenewal(null, now)).toBe(true);
  });

  it("renews when expiry is within the lead window or already past", () => {
    const soon = new Date(now.getTime() + WATCH_RENEWAL_LEAD_MS - 1000);
    const past = new Date(now.getTime() - 1000);
    expect(watchNeedsRenewal(soon, now)).toBe(true);
    expect(watchNeedsRenewal(past, now)).toBe(true);
  });

  it("does not renew when expiry is comfortably in the future", () => {
    const later = new Date(now.getTime() + WATCH_RENEWAL_LEAD_MS + 60_000);
    expect(watchNeedsRenewal(later, now)).toBe(false);
  });
});
