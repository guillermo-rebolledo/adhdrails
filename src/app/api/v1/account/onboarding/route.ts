import { hasCompletedOnboarding } from "@/domain/account/onboarding";
import { getAccountSummary } from "@/server/auth/session";
import { createAccountRepository } from "@/server/account/repository";
import {
  type AccountService,
  createAccountService,
} from "@/server/account/service";
import { accountFailureResponse } from "@/server/account/http";
import { getDatabase } from "@/server/db/connection";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface OnboardingRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => AccountService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: OnboardingRouteDependencies = {
  getAccountSummary,
  getService: () =>
    createAccountService(createAccountRepository(getDatabase())),
  createCorrelationId: correlationIdFrom,
};

export function createOnboardingRouteHandler(
  deps: OnboardingRouteDependencies,
) {
  return async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps
      .getService()
      .completeOnboarding(account.userId, await readJsonPayload(request));

    if (!result.ok) {
      return accountFailureResponse(result, correlationId);
    }

    logOperationalEvent({
      correlationId,
      action: "account.onboarding_completed",
      outcome: "success",
    });

    return jsonResponse(
      {
        userId: result.profile.userId,
        timezone: result.profile.timezone,
        locale: result.profile.locale,
        onboardingCompleted: hasCompletedOnboarding(result.profile),
      },
      correlationId,
    );
  };
}

export const POST = createOnboardingRouteHandler(dependencies);
