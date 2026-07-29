import {
  type AccountProfileResponse,
  accountProfileResponseSchema,
  hasCompletedOnboarding,
} from "@/domain/account/onboarding";
import {
  accountNotFoundProblem,
  validationProblem,
} from "@/server/http/problem";

import type { AccountProfile } from "./repository";
import type { AccountResult } from "./service";

export function serializeAccountProfile(
  profile: AccountProfile,
): AccountProfileResponse {
  return accountProfileResponseSchema.parse({
    userId: profile.userId,
    email: profile.email,
    name: profile.name,
    timezone: profile.timezone,
    locale: profile.locale,
    onboardingCompleted: hasCompletedOnboarding(profile),
    onboardingCompletedAt: profile.onboardingCompletedAt?.toISOString() ?? null,
  });
}

/** Maps a failed account use-case outcome to its Problem Details response. */
export function accountFailureResponse(
  result: Extract<AccountResult, { ok: false }>,
  correlationId: string,
): Response {
  return result.reason === "invalid"
    ? validationProblem(correlationId, result.fieldErrors)
    : accountNotFoundProblem(correlationId);
}
