import { getAccountDeletionService } from "@/server/account/service-factory";
import type { AccountDeletionService } from "@/server/account/deletion-service";
import { getAccountSummary } from "@/server/auth/session";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem, validationProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";

export interface AccountDeletionRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => AccountDeletionService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: AccountDeletionRouteDependencies = {
  getAccountSummary,
  getService: getAccountDeletionService,
  createCorrelationId: correlationIdFrom,
};

export function createAccountDeletionRouteHandlers(
  deps: AccountDeletionRouteDependencies,
) {
  async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);
    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps
      .getService()
      .requestDeletion(
        account.userId,
        await readJsonPayload(request),
        correlationId,
      );
    if (!result.ok) {
      return validationProblem(correlationId, result.fieldErrors);
    }

    return jsonResponse(
      result.status,
      correlationId,
      result.created ? 202 : 200,
    );
  }

  return { POST };
}

export const { POST } = createAccountDeletionRouteHandlers(dependencies);
