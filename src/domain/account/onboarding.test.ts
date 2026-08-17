import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  accountProfileSchema,
  deriveInitialLocale,
  deriveInitialTimeZone,
  hasCompletedOnboarding,
  resolveAuthenticatedLanding,
  resolveEffectiveTimeZone,
  timeZoneNeedsCapture,
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

describe("timeZoneNeedsCapture", () => {
  it("is true only when the account has no usable zone", () => {
    expect(timeZoneNeedsCapture(null)).toBe(true);
    expect(timeZoneNeedsCapture(undefined)).toBe(true);
    expect(timeZoneNeedsCapture("")).toBe(true);
    expect(timeZoneNeedsCapture("Mars/Phobos")).toBe(true);
  });

  it("is false for a stored zone, including a deliberate UTC", () => {
    expect(timeZoneNeedsCapture("America/New_York")).toBe(false);
    // The whole point of the nullable column: an explicit UTC is a real answer,
    // no longer indistinguishable from never having been asked.
    expect(timeZoneNeedsCapture(DEFAULT_TIMEZONE)).toBe(false);
  });
});

describe("resolveEffectiveTimeZone", () => {
  it("uses the account's zone whenever it is known", () => {
    expect(
      resolveEffectiveTimeZone("America/New_York", "America/Mexico_City"),
    ).toBe("America/New_York");
  });

  it("respects a deliberate UTC over the browser", () => {
    expect(resolveEffectiveTimeZone("UTC", "America/Mexico_City")).toBe("UTC");
  });

  it("falls back to the browser when the account's zone is unknown", () => {
    expect(resolveEffectiveTimeZone(null, "America/Mexico_City")).toBe(
      "America/Mexico_City",
    );
  });

  it("falls back to the default with no browser to ask — the server case", () => {
    expect(resolveEffectiveTimeZone(null)).toBe(DEFAULT_TIMEZONE);
    expect(resolveEffectiveTimeZone(null, null)).toBe(DEFAULT_TIMEZONE);
  });

  it("ignores an unusable zone on either side", () => {
    expect(resolveEffectiveTimeZone("Mars/Phobos", "America/Mexico_City")).toBe(
      "America/Mexico_City",
    );
    expect(resolveEffectiveTimeZone(null, "Mars/Phobos")).toBe(
      DEFAULT_TIMEZONE,
    );
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
