import { z } from "zod";

import {
  accountProfileSchema,
  hasCompletedOnboarding,
} from "@/domain/account/onboarding";
import { getAccountSummary } from "@/server/auth/session";
import {
  type AccountProfile,
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

export interface AccountRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getRepository: () => AccountRepository;
  createCorrelationId: (request: Request) => string;
}

const dependencies: AccountRouteDependencies = {
  getAccountSummary,
  getRepository: () => createAccountRepository(getDatabase()),
  createCorrelationId: correlationIdFrom,
};

function serializeProfile(profile: AccountProfile) {
  return {
    userId: profile.userId,
    email: profile.email,
    name: profile.name,
    timezone: profile.timezone,
    locale: profile.locale,
    onboardingCompleted: hasCompletedOnboarding(profile),
    onboardingCompletedAt: profile.onboardingCompletedAt?.toISOString() ?? null,
  };
}

function jsonResponse(body: unknown, correlationId: string): Response {
  return Response.json(body, {
    headers: {
      [CORRELATION_ID_HEADER]: correlationId,
      "cache-control": "no-store",
    },
  });
}

function notFoundProblem(correlationId: string): Response {
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

export function createAccountRouteHandlers(deps: AccountRouteDependencies) {
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const profile = await deps.getRepository().getProfile(account.userId);

    if (!profile) {
      return notFoundProblem(correlationId);
    }

    return jsonResponse(serializeProfile(profile), correlationId);
  }

  async function PATCH(request: Request): Promise<Response> {
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
      .updateProfile(account.userId, parsed.data);

    if (!profile) {
      return notFoundProblem(correlationId);
    }

    logOperationalEvent({
      correlationId,
      action: "account.profile_updated",
      outcome: "success",
    });

    return jsonResponse(serializeProfile(profile), correlationId);
  }

  return { GET, PATCH };
}

const handlers = createAccountRouteHandlers(dependencies);

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
