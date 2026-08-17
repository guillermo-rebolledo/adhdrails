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

export interface TimeZoneRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => AccountService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: TimeZoneRouteDependencies = {
  getAccountSummary,
  getService: () =>
    createAccountService(createAccountRepository(getDatabase())),
  createCorrelationId: correlationIdFrom,
};

/**
 * Captures the zone the browser reports into an account that has none.
 *
 * Separate from `PATCH /api/v1/account` on purpose. That endpoint expresses a
 * user's choice and overwrites whatever is stored; this one may only fill in an
 * unknown zone and touches no other field, which is what makes it safe for the
 * client to attempt automatically on load. An account that already knows its
 * zone gets its profile back unchanged.
 */
export function createTimeZoneRouteHandlers(deps: TimeZoneRouteDependencies) {
  async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps
      .getService()
      .captureTimeZone(account.userId, await readJsonPayload(request));

    if (!result.ok) {
      return accountFailureResponse(result, correlationId);
    }

    logOperationalEvent({
      correlationId,
      action: "account.timezone_captured",
      outcome: "success",
    });

    return jsonResponse(serializeAccountProfile(result.profile), correlationId);
  }

  return { POST };
}

const handlers = createTimeZoneRouteHandlers(dependencies);

export const POST = handlers.POST;
