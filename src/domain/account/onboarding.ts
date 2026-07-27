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
 * A trimmed, validated time zone and locale are always present; both fall back
 * to sensible defaults rather than rejecting the account.
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
