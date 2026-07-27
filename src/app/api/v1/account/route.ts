import { getAccountSummary } from "@/server/auth/session";
import { createAccountRepository } from "@/server/account/repository";
import {
  type AccountService,
  createAccountService,
} from "@/server/account/service";
import {
  accountFailureResponse,
  serializeAccountProfile,
} from "@/server/account/http";
import { getDatabase } from "@/server/db/connection";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface AccountRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => AccountService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: AccountRouteDependencies = {
  getAccountSummary,
  getService: () =>
    createAccountService(createAccountRepository(getDatabase())),
  createCorrelationId: correlationIdFrom,
};

export function createAccountRouteHandlers(deps: AccountRouteDependencies) {
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps.getService().getProfile(account.userId);

    return result.ok
      ? jsonResponse(serializeAccountProfile(result.profile), correlationId)
      : accountFailureResponse(result, correlationId);
  }

  async function PATCH(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps
      .getService()
      .updateProfile(account.userId, await readJsonPayload(request));

    if (!result.ok) {
      return accountFailureResponse(result, correlationId);
    }

    logOperationalEvent({
      correlationId,
      action: "account.profile_updated",
      outcome: "success",
    });

    return jsonResponse(serializeAccountProfile(result.profile), correlationId);
  }

  return { GET, PATCH };
}

const handlers = createAccountRouteHandlers(dependencies);

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
