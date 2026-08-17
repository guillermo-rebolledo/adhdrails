import { describe, expect, it } from "vitest";

import {
  SENSITIVE_PLACEHOLDER,
  assertReadableEnvironment,
  findUnreadableKeys,
  localEnvironmentFile,
} from "./environment-source";

describe("localEnvironmentFile", () => {
  it("names a per-target file covered by the .env* gitignore rule", () => {
    expect(localEnvironmentFile("production")).toBe(".env.production.local");
    expect(localEnvironmentFile("staging")).toBe(".env.staging.local");
  });
});

describe("findUnreadableKeys", () => {
  it("returns nothing when every variable carries a real value", () => {
    expect(
      findUnreadableKeys({
        APP_ENV: "production",
        DATABASE_URL: "postgres://",
      }),
    ).toEqual([]);
  });

  it("names only the placeholder variables, sorted", () => {
    expect(
      findUnreadableKeys({
        DATABASE_URL: SENSITIVE_PLACEHOLDER,
        APP_ENV: SENSITIVE_PLACEHOLDER,
        VERCEL_ENV: "production",
      }),
    ).toEqual(["APP_ENV", "DATABASE_URL"]);
  });

  it("treats a surrounding-whitespace placeholder as unreadable", () => {
    expect(
      findUnreadableKeys({ APP_ENV: ` ${SENSITIVE_PLACEHOLDER} ` }),
    ).toEqual(["APP_ENV"]);
  });

  it("ignores undefined and empty values, which other guards report", () => {
    expect(
      findUnreadableKeys({ APP_ENV: undefined, DATABASE_URL: "" }),
    ).toEqual([]);
  });

  it("does not match a value that merely contains the placeholder", () => {
    expect(
      findUnreadableKeys({ NOTE: `redacted ${SENSITIVE_PLACEHOLDER} value` }),
    ).toEqual([]);
  });
});

describe("assertReadableEnvironment", () => {
  it("accepts an environment with no placeholders", () => {
    expect(() =>
      assertReadableEnvironment({
        target: "production",
        environment: { APP_ENV: "production" },
        source: "vercel env pull",
      }),
    ).not.toThrow();
  });

  it("names the offending variables, the source, and the file to create", () => {
    expect(() =>
      assertReadableEnvironment({
        target: "production",
        environment: {
          APP_ENV: SENSITIVE_PLACEHOLDER,
          DATABASE_URL: SENSITIVE_PLACEHOLDER,
        },
        source: "vercel env pull",
      }),
    ).toThrow(/APP_ENV, DATABASE_URL[\s\S]*\.env\.production\.local/);
  });

  it("reports the staging file when releasing to staging", () => {
    expect(() =>
      assertReadableEnvironment({
        target: "staging",
        environment: { APP_ENV: SENSITIVE_PLACEHOLDER },
        source: "vercel env pull",
      }),
    ).toThrow(/\.env\.staging\.local/);
  });

  it("never echoes a real secret value", () => {
    const secret = "super-secret-connection-string";

    let message = "";
    try {
      assertReadableEnvironment({
        target: "production",
        environment: {
          APP_ENV: SENSITIVE_PLACEHOLDER,
          DATABASE_URL: secret,
        },
        source: "vercel env pull",
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("APP_ENV");
    expect(message).not.toContain(secret);
  });
});
