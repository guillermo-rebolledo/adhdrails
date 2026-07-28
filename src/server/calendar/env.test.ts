import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { readCalendarTokenKeyring, readGoogleOAuthConfig } from "./env";

describe("readCalendarTokenKeyring", () => {
  it("derives a development key when none is configured", () => {
    const keyring = readCalendarTokenKeyring({ NODE_ENV: "test" });

    expect(keyring.currentVersion).toBe(1);
    expect(keyring.keys.get(1)?.byteLength).toBe(32);
  });

  it("reads configured base64 keys and selects the current version", () => {
    const v1 = randomBytes(32).toString("base64");
    const v2 = randomBytes(32).toString("base64");

    const keyring = readCalendarTokenKeyring({
      NODE_ENV: "test",
      CALENDAR_TOKEN_KEY_VERSION: "2",
      CALENDAR_TOKEN_KEY_V1: v1,
      CALENDAR_TOKEN_KEY_V2: v2,
    });

    expect(keyring.currentVersion).toBe(2);
    expect(keyring.keys.get(1)?.toString("base64")).toBe(v1);
    expect(keyring.keys.get(2)?.toString("base64")).toBe(v2);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() =>
      readCalendarTokenKeyring({
        NODE_ENV: "test",
        CALENDAR_TOKEN_KEY_V1: Buffer.from("too-short").toString("base64"),
      }),
    ).toThrow(/32-byte/);
  });

  it("requires the current version key in production", () => {
    expect(() => readCalendarTokenKeyring({ NODE_ENV: "production" })).toThrow(
      /required in production/,
    );
  });
});

describe("readGoogleOAuthConfig", () => {
  it("derives the calendar callback redirect from the base URL", () => {
    const config = readGoogleOAuthConfig({
      NODE_ENV: "test",
      BETTER_AUTH_URL: "https://rails.example",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
    });

    expect(config.redirectUri).toBe(
      "https://rails.example/api/calendar/callback",
    );
    expect(config.clientId).toBe("id");
  });

  it("requires credentials in production", () => {
    expect(() => readGoogleOAuthConfig({ NODE_ENV: "production" })).toThrow(
      /required in production/,
    );
  });
});
