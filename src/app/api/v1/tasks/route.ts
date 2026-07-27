import { getDatabase } from "@/server/db/connection";
import { getAccountSummary } from "@/server/auth/session";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";
import { serializeTask, taskCreateFailureResponse } from "@/server/task/http";
import { createTaskRepository } from "@/server/task/repository";
import { type TaskService, createTaskService } from "@/server/task/service";

export interface TasksRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => TaskService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: TasksRouteDependencies = {
  getAccountSummary,
  getService: () => createTaskService(createTaskRepository(getDatabase())),
  createCorrelationId: correlationIdFrom,
};

export function createTasksRouteHandlers(deps: TasksRouteDependencies) {
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const items = await deps.getService().listActiveForAccount(account.userId);

    return jsonResponse({ items: items.map(serializeTask) }, correlationId);
  }

  async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps
      .getService()
      .create(account.userId, await readJsonPayload(request));

    if (!result.ok) {
      return taskCreateFailureResponse(result, correlationId);
    }

    if (result.created) {
      logOperationalEvent({
        correlationId,
        action: "task.created",
        outcome: "success",
      });
    }

    return jsonResponse(
      serializeTask(result.item),
      correlationId,
      result.created ? 201 : 200,
    );
  }

  return { GET, POST };
}

const handlers = createTasksRouteHandlers(dependencies);

export const GET = handlers.GET;
export const POST = handlers.POST;
