import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/domain/account/onboarding";

import { getAuth } from "./index";

export interface AccountSummary {
  userId: string;
  email: string;
  name: string;
  timezone: string;
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

  if (!context?.user) {
    return null;
  }

  const { user } = context;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    timezone: user.timezone ?? DEFAULT_TIMEZONE,
    locale: user.locale ?? DEFAULT_LOCALE,
    onboardingCompletedAt: user.onboardingCompletedAt ?? null,
  };
}
