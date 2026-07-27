import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  accountProfileSchema,
  deriveInitialLocale,
  deriveInitialTimeZone,
  hasCompletedOnboarding,
  resolveAuthenticatedLanding,
  resolveProtectedRouteRedirect,
} from "./onboarding";

describe("deriveInitialTimeZone", () => {
  it("keeps a recognised IANA time zone", () => {
    expect(deriveInitialTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("falls back to the default for unknown or empty input", () => {
    expect(deriveInitialTimeZone("Mars/Phobos")).toBe(DEFAULT_TIMEZONE);
    expect(deriveInitialTimeZone("")).toBe(DEFAULT_TIMEZONE);
    expect(deriveInitialTimeZone(null)).toBe(DEFAULT_TIMEZONE);
    expect(deriveInitialTimeZone(undefined)).toBe(DEFAULT_TIMEZONE);
  });
});

describe("deriveInitialLocale", () => {
  it("canonicalises a recognised locale", () => {
    expect(deriveInitialLocale("en-us")).toBe("en-US");
  });

  it("falls back to the default for unusable input", () => {
    expect(deriveInitialLocale("not a locale!")).toBe(DEFAULT_LOCALE);
    expect(deriveInitialLocale("")).toBe(DEFAULT_LOCALE);
    expect(deriveInitialLocale(null)).toBe(DEFAULT_LOCALE);
  });
});

describe("hasCompletedOnboarding", () => {
  it("is true only once a completion instant is recorded", () => {
    expect(hasCompletedOnboarding({ onboardingCompletedAt: null })).toBe(false);
    expect(hasCompletedOnboarding({ onboardingCompletedAt: new Date() })).toBe(
      true,
    );
  });
});

describe("resolveProtectedRouteRedirect", () => {
  it("sends anonymous requests to sign-in", () => {
    expect(
      resolveProtectedRouteRedirect({ authenticated: false, onboarded: false }),
    ).toBe("/signin");
  });

  it("sends signed-in but un-onboarded accounts to onboarding", () => {
    expect(
      resolveProtectedRouteRedirect({ authenticated: true, onboarded: false }),
    ).toBe("/onboarding");
  });

  it("admits an onboarded account regardless of Calendar access", () => {
    expect(
      resolveProtectedRouteRedirect({ authenticated: true, onboarded: true }),
    ).toBeNull();
  });
});

describe("resolveAuthenticatedLanding", () => {
  it("leaves anonymous visitors on the current page", () => {
    expect(
      resolveAuthenticatedLanding({ authenticated: false, onboarded: false }),
    ).toBeNull();
  });

  it("routes signed-in accounts by onboarding state", () => {
    expect(
      resolveAuthenticatedLanding({ authenticated: true, onboarded: false }),
    ).toBe("/onboarding");
    expect(
      resolveAuthenticatedLanding({ authenticated: true, onboarded: true }),
    ).toBe("/today");
  });
});

describe("accountProfileSchema", () => {
  it("accepts and trims a valid profile", () => {
    expect(
      accountProfileSchema.parse({
        timezone: "  Europe/Madrid  ",
        locale: " en-GB ",
      }),
    ).toEqual({ timezone: "Europe/Madrid", locale: "en-GB" });
  });

  it("rejects an unknown time zone", () => {
    expect(
      accountProfileSchema.safeParse({ timezone: "Nowhere", locale: "en-US" })
        .success,
    ).toBe(false);
  });
});
