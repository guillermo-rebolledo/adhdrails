import { getDatabase } from "@/server/db/connection";
import { getAccountSummary } from "@/server/auth/session";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";
import {
  inboxUpdateFailureResponse,
  serializeInboxItem,
} from "@/server/inbox/http";
import { createInboxRepository } from "@/server/inbox/repository";
import { type InboxService, createInboxService } from "@/server/inbox/service";

export interface InboxItemRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => InboxService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: InboxItemRouteDependencies = {
  getAccountSummary,
  getService: () => createInboxService(createInboxRepository(getDatabase())),
  createCorrelationId: correlationIdFrom,
};

export function createInboxItemRouteHandlers(deps: InboxItemRouteDependencies) {
  async function PATCH(request: Request, id: string): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps
      .getService()
      .update(account.userId, id, await readJsonPayload(request));

    if (!result.ok) {
      return inboxUpdateFailureResponse(result, correlationId);
    }

    return jsonResponse(serializeInboxItem(result.item), correlationId);
  }

  async function DELETE(request: Request, id: string): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    await deps.getService().remove(account.userId, id);

    logOperationalEvent({
      correlationId,
      action: "inbox.item_deleted",
      outcome: "success",
    });

    return jsonResponse({ ok: true }, correlationId);
  }

  return { PATCH, DELETE };
}

const handlers = createInboxItemRouteHandlers(dependencies);

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  return handlers.PATCH(request, id);
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  return handlers.DELETE(request, id);
}
