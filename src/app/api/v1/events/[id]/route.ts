import { getDatabase } from "@/server/db/connection";
import { getAccountSummary } from "@/server/auth/session";
import {
  eventUpdateFailureResponse,
  serializeEvent,
} from "@/server/event/http";
import { createEventRepository } from "@/server/event/repository";
import { type EventService, createEventService } from "@/server/event/service";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface EventItemRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => EventService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: EventItemRouteDependencies = {
  getAccountSummary,
  getService: () => createEventService(createEventRepository(getDatabase())),
  createCorrelationId: correlationIdFrom,
};

export function createEventItemRouteHandlers(deps: EventItemRouteDependencies) {
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
      return eventUpdateFailureResponse(result, correlationId);
    }

    return jsonResponse(serializeEvent(result.item), correlationId);
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
      action: "event.deleted",
      outcome: "success",
    });

    return jsonResponse({ ok: true }, correlationId);
  }

  return { PATCH, DELETE };
}

const handlers = createEventItemRouteHandlers(dependencies);

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
