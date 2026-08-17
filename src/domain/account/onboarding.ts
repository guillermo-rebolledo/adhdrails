import { z } from "zod";

export const DEFAULT_TIMEZONE = "UTC";
export const DEFAULT_LOCALE = "en-US";

/**
 * A validated IANA time zone identifier. Falls back to {@link DEFAULT_TIMEZONE}
 * so an unrecognised value can never leave a Task or Event at the wrong instant.
 */
export function isValidTimeZone(candidate: string): boolean {
  if (candidate.trim() === "") {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

export function deriveInitialTimeZone(candidate?: string | null): string {
  if (candidate && isValidTimeZone(candidate)) {
    return candidate;
  }

  return DEFAULT_TIMEZONE;
}

/**
 * Whether an account has never told Rails where it is. `user.timezone` is
 * nullable precisely so this question has an answer: `null` is "unknown", not
 * "UTC". An unknown zone is what the client captures from the browser.
 */
export function timeZoneNeedsCapture(
  accountTimeZone: string | null | undefined,
): boolean {
  return !accountTimeZone || !isValidTimeZone(accountTimeZone);
}

/**
 * The single rule for which zone a clock time is rendered in, used by every
 * surface in the app so no two screens can disagree.
 *
 * The account's stored zone wins whenever it is known — including a deliberate
 * `UTC`, which is now distinguishable from "never set". When it is unknown, the
 * browser's zone is used; the stored instant is authoritative either way, so
 * only the presentation is at stake. {@link DEFAULT_TIMEZONE} is the last
 * resort, for the server, where no browser exists to ask.
 */
export function resolveEffectiveTimeZone(
  accountTimeZone: string | null | undefined,
  detectedTimeZone?: string | null,
): string {
  if (accountTimeZone && isValidTimeZone(accountTimeZone)) {
    return accountTimeZone;
  }

  return deriveInitialTimeZone(detectedTimeZone);
}

/**
 * A canonical BCP 47 formatting locale. Interface copy stays English; only the
 * date/number formatting locale is derived here.
 */
export function isValidLocale(candidate: string): boolean {
  if (candidate.trim() === "") {
    return false;
  }

  try {
    return Intl.getCanonicalLocales(candidate).length > 0;
  } catch {
    return false;
  }
}

export function deriveInitialLocale(candidate?: string | null): string {
  if (candidate && isValidLocale(candidate)) {
    return Intl.getCanonicalLocales(candidate)[0];
  }

  return DEFAULT_LOCALE;
}

export interface AccountOnboardingState {
  onboardingCompletedAt: Date | null;
}

export function hasCompletedOnboarding(state: AccountOnboardingState): boolean {
  return state.onboardingCompletedAt !== null;
}

export interface SessionState {
  authenticated: boolean;
  onboarded: boolean;
}

/**
 * Where a request for a protected app route should be sent. `null` means the
 * account is allowed straight into the app; otherwise the returned path is the
 * redirect target. Calendar access is never part of this decision, so an
 * account that skipped Calendar setup still resolves to `null`.
 */
export function resolveProtectedRouteRedirect(
  state: SessionState,
): "/signin" | "/onboarding" | null {
  if (!state.authenticated) {
    return "/signin";
  }

  if (!state.onboarded) {
    return "/onboarding";
  }

  return null;
}

/**
 * Where an authenticated account should land when it reaches sign-in or
 * onboarding entry points, or `null` when it should stay on the current page.
 */
export function resolveAuthenticatedLanding(
  state: SessionState,
): "/today" | "/onboarding" | null {
  if (!state.authenticated) {
    return null;
  }

  return state.onboarded ? "/today" : "/onboarding";
}

/**
 * Shared contract for completing onboarding and for later edits from Settings.
 * A trimmed, validated time zone and locale are always present: both of these
 * callers know the values they are setting, so neither may leave the zone
 * unknown.
 */
export const accountProfileSchema = z.object({
  timezone: z
    .string()
    .trim()
    .refine(isValidTimeZone, { message: "Unknown time zone." }),
  locale: z
    .string()
    .trim()
    .refine(isValidLocale, { message: "Unknown locale." }),
});

export type AccountProfileInput = z.infer<typeof accountProfileSchema>;

/**
 * Response contract for the account profile returned by `/api/v1/account`.
 * Shared by the route serializer, the UI, and tests.
 */
export const accountProfileResponseSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  /** `null` until the account's zone is known. See `timeZoneNeedsCapture`. */
  timezone: z.string().nullable(),
  locale: z.string(),
  onboardingCompleted: z.boolean(),
  onboardingCompletedAt: z.string().nullable(),
});

export type AccountProfileResponse = z.infer<
  typeof accountProfileResponseSchema
>;

/**
 * Contract for capturing a browser-detected time zone into an account that has
 * none. Deliberately narrower than {@link accountProfileSchema}: capture may
 * only ever fill in an unknown zone, never change a known one or touch any
 * other field, so it is safe to attempt on every page load.
 */
export const timeZoneCaptureSchema = z.object({
  timezone: z
    .string()
    .trim()
    .refine(isValidTimeZone, { message: "Unknown time zone." }),
});

export type TimeZoneCaptureInput = z.infer<typeof timeZoneCaptureSchema>;
