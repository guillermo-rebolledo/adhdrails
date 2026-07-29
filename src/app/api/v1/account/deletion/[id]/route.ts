import { z } from "zod";

import { getAccountDeletionService } from "@/server/account/service-factory";
import type { AccountDeletionService } from "@/server/account/deletion-service";
import { jsonResponse } from "@/server/http/json";
import { notFoundProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";

export interface AccountDeletionStatusRouteDependencies {
  getService: () => AccountDeletionService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: AccountDeletionStatusRouteDependencies = {
  getService: getAccountDeletionService,
  createCorrelationId: correlationIdFrom,
};

const receiptSchema = z.uuid();

export function createAccountDeletionStatusRouteHandlers(
  deps: AccountDeletionStatusRouteDependencies,
) {
  async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const parsed = receiptSchema.safeParse((await context.params).id);
    if (!parsed.success) {
      return notFoundProblem(correlationId);
    }

    const status = await deps.getService().getStatus(parsed.data);
    return status
      ? jsonResponse(status, correlationId)
      : notFoundProblem(correlationId);
  }

  return { GET };
}

export const { GET } = createAccountDeletionStatusRouteHandlers(dependencies);
