import { z } from "zod";

import {
  accountProfileSchema,
  hasCompletedOnboarding,
} from "@/domain/account/onboarding";
import { getAccountSummary } from "@/server/auth/session";
import {
  type AccountRepository,
  createAccountRepository,
} from "@/server/account/repository";
import { getDatabase } from "@/server/db/connection";
import {
  problemResponse,
  unauthorizedProblem,
  validationProblem,
} from "@/server/http/problem";
import {
  CORRELATION_ID_HEADER,
  correlationIdFrom,
} from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface OnboardingRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getRepository: () => AccountRepository;
  createCorrelationId: (request: Request) => string;
}

const dependencies: OnboardingRouteDependencies = {
  getAccountSummary,
  getRepository: () => createAccountRepository(getDatabase()),
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

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      payload = undefined;
    }

    const parsed = accountProfileSchema.safeParse(payload);
    if (!parsed.success) {
      return validationProblem(
        correlationId,
        z.flattenError(parsed.error).fieldErrors,
      );
    }

    const profile = await deps
      .getRepository()
      .completeOnboarding(account.userId, parsed.data);

    if (!profile) {
      return problemResponse({
        type: "https://rails.app/problems/account-not-found",
        title: "Account not found",
        status: 404,
        code: "not_found",
        detail: "The signed-in account no longer exists.",
        correlationId,
        retryable: false,
      });
    }

    logOperationalEvent({
      correlationId,
      action: "account.onboarding_completed",
      outcome: "success",
    });

    return Response.json(
      {
        userId: profile.userId,
        timezone: profile.timezone,
        locale: profile.locale,
        onboardingCompleted: hasCompletedOnboarding(profile),
      },
      {
        headers: {
          [CORRELATION_ID_HEADER]: correlationId,
          "cache-control": "no-store",
        },
      },
    );
  };
}

export const POST = createOnboardingRouteHandler(dependencies);
