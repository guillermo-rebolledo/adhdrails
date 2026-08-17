import { DEFAULT_LOCALE } from "@/domain/account/onboarding";

import { getAuth } from "./index";

export interface AccountSummary {
  userId: string;
  email: string;
  name: string;
  /**
   * `null` when the account has never told Rails where it is. Deliberately not
   * coerced to a default here: a caller that renders a clock time must decide
   * between the browser's zone (client) and {@link DEFAULT_TIMEZONE} (server),
   * and that decision belongs at the call site, not hidden in this boundary.
   */
  timezone: string | null;
  locale: string;
  onboardingCompletedAt: Date | null;
}

/**
 * Resolves the authenticated account for a request, or `null` when there is no
 * valid session. Every repository and route handler derives its ownership scope
 * from this summary — there is no ambient "current user".
 */
export async function getAccountSummary(
  requestHeaders: Headers,
): Promise<AccountSummary | null> {
  const context = await getAuth().api.getSession({ headers: requestHeaders });

  if (!context?.user || context.user.deletionRequestedAt) {
    return null;
  }

  const { user } = context;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    timezone: user.timezone ?? null,
    locale: user.locale ?? DEFAULT_LOCALE,
    onboardingCompletedAt: user.onboardingCompletedAt ?? null,
  };
}
