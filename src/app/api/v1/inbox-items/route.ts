import { getDatabase } from "@/server/db/connection";
import {
  inboxCaptureFailureResponse,
  serializeInboxItem,
} from "@/server/inbox/http";
import { createInboxRepository } from "@/server/inbox/repository";
import { type InboxService, createInboxService } from "@/server/inbox/service";
import { getAccountSummary } from "@/server/auth/session";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface InboxRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => InboxService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: InboxRouteDependencies = {
  getAccountSummary,
  getService: () => createInboxService(createInboxRepository(getDatabase())),
  createCorrelationId: correlationIdFrom,
};

export function createInboxRouteHandlers(deps: InboxRouteDependencies) {
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const items = await deps.getService().listForAccount(account.userId);

    return jsonResponse(
      { items: items.map(serializeInboxItem) },
      correlationId,
    );
  }

  async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps
      .getService()
      .capture(account.userId, await readJsonPayload(request));

    if (!result.ok) {
      return inboxCaptureFailureResponse(result, correlationId);
    }

    if (result.created) {
      logOperationalEvent({
        correlationId,
        action: "inbox.item_captured",
        outcome: "success",
      });
    }

    return jsonResponse(
      serializeInboxItem(result.item),
      correlationId,
      result.created ? 201 : 200,
    );
  }

  return { GET, POST };
}

const handlers = createInboxRouteHandlers(dependencies);

export const GET = handlers.GET;
export const POST = handlers.POST;
