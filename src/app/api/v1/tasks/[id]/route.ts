import { getAccountSummary } from "@/server/auth/session";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";
import { serializeTask, taskUpdateFailureResponse } from "@/server/task/http";
import type { TaskService } from "@/server/task/service";

import { taskServiceFor } from "../service-factory";

export interface TaskItemRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => TaskService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: TaskItemRouteDependencies = {
  getAccountSummary,
  getService: taskServiceFor,
  createCorrelationId: correlationIdFrom,
};

export function createTaskItemRouteHandlers(deps: TaskItemRouteDependencies) {
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
      return taskUpdateFailureResponse(result, correlationId);
    }

    return jsonResponse(serializeTask(result.item), correlationId);
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
      action: "task.deleted",
      outcome: "success",
    });

    return jsonResponse({ ok: true }, correlationId);
  }

  return { PATCH, DELETE };
}

const handlers = createTaskItemRouteHandlers(dependencies);

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
