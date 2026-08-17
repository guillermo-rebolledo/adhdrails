import { describe, expect, it } from "vitest";

import {
  assertPreviewIsolation,
  assertReleaseEnvironment,
} from "./environment";

function stagingEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ENV: "staging",
    DATABASE_URL:
      "postgresql://user:pw@staging-db.neon.tech/rails?sslmode=require",
    BETTER_AUTH_SECRET: "staging-auth-secret",
    BETTER_AUTH_URL: "https://staging.rails.app",
    NEXT_PUBLIC_APP_URL: "https://staging.rails.app",
    GOOGLE_CLIENT_ID: "staging-client-id",
    GOOGLE_CLIENT_SECRET: "staging-client-secret",
    CALENDAR_TOKEN_KEY_VERSION: "1",
    CALENDAR_TOKEN_KEY_V1: "c3RhZ2luZy1rZXk=",
    VAPID_SUBJECT: "mailto:support@staging.rails.app",
    VAPID_PUBLIC_KEY: "staging-vapid-public",
    VAPID_PRIVATE_KEY: "staging-vapid-private",
    ...overrides,
  };
}

function productionEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    ...stagingEnvironment(),
    APP_ENV: "production",
    DATABASE_URL:
      "postgresql://user:pw@prod-db.neon.tech/rails?sslmode=require",
    BETTER_AUTH_URL: "https://rails.app",
    NEXT_PUBLIC_APP_URL: "https://rails.app",
    OPERATIONAL_AUDIT_PSEUDONYM_SECRET: "prod-pseudonym-secret",
    NEON_API_KEY: "neon-api-key",
    NEON_PROJECT_ID: "rails-production",
    NEON_BRANCH_ID: "br-production",
    ...overrides,
  };
}

describe("assertReleaseEnvironment", () => {
  it("accepts a complete, matching staging environment", () => {
    const summary = assertReleaseEnvironment({
      target: "staging",
      environment: stagingEnvironment(),
    });

    expect(summary).toEqual({
      target: "staging",
      appHost: "staging.rails.app",
      databaseHost: "staging-db.neon.tech",
    });
  });

  it("accepts a complete, matching production environment", () => {
    expect(() =>
      assertReleaseEnvironment({
        target: "production",
        environment: productionEnvironment(),
      }),
    ).not.toThrow();
  });

  it("refuses to mutate when the loaded environment targets a different tier", () => {
    expect(() =>
      assertReleaseEnvironment({
        target: "production",
        environment: stagingEnvironment(),
      }),
    ).toThrow(
      'Refusing to release to production: the loaded environment is APP_ENV="staging".',
    );
  });

  it("requires APP_ENV to be set at all", () => {
    expect(() =>
      assertReleaseEnvironment({
        target: "staging",
        environment: stagingEnvironment({ APP_ENV: undefined }),
      }),
    ).toThrow(/APP_ENV/);
  });

  it.each([
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "CALENDAR_TOKEN_KEY_V1",
    "VAPID_PRIVATE_KEY",
  ])("fails closed when %s is missing", (name) => {
    expect(() =>
      assertReleaseEnvironment({
        target: "staging",
        environment: stagingEnvironment({ [name]: undefined }),
      }),
    ).toThrow(name);
  });

  it.each([
    "OPERATIONAL_AUDIT_PSEUDONYM_SECRET",
    "NEON_API_KEY",
    "NEON_PROJECT_ID",
    "NEON_BRANCH_ID",
  ])("requires %s for production but not for staging", (name) => {
    expect(() =>
      assertReleaseEnvironment({
        target: "production",
        environment: productionEnvironment({ [name]: undefined }),
      }),
    ).toThrow(name);

    // Staging does not require the production-only keys.
    expect(() =>
      assertReleaseEnvironment({
        target: "staging",
        environment: stagingEnvironment(),
      }),
    ).not.toThrow();
  });

  it("rejects a split-brain browser/server URL configuration", () => {
    expect(() =>
      assertReleaseEnvironment({
        target: "staging",
        environment: stagingEnvironment({
          NEXT_PUBLIC_APP_URL: "https://other.rails.app",
        }),
      }),
    ).toThrow(/BETTER_AUTH_URL.*NEXT_PUBLIC_APP_URL|same host/i);
  });

  it("never includes a secret value in a failure message", () => {
    let message = "";
    try {
      assertReleaseEnvironment({
        target: "production",
        environment: stagingEnvironment({
          BETTER_AUTH_SECRET: "super-secret-value",
        }),
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain("super-secret-value");
    expect(message).not.toContain("staging-client-secret");
  });
});

describe("assertPreviewIsolation", () => {
  it("allows a preview that carries no production markers", () => {
    expect(() =>
      assertPreviewIsolation({ VERCEL_ENV: "preview", APP_ENV: "staging" }),
    ).not.toThrow();
  });

  it("blocks a preview deployment that carries production configuration", () => {
    expect(() =>
      assertPreviewIsolation({ VERCEL_ENV: "preview", APP_ENV: "production" }),
    ).toThrow(/preview.*production/i);
  });

  it("ignores non-preview runtimes", () => {
    expect(() =>
      assertPreviewIsolation({
        VERCEL_ENV: "production",
        APP_ENV: "production",
      }),
    ).not.toThrow();
  });
});
