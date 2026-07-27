import {
  TASK_COLLECTION_PAGE_SIZE,
  taskCollectionPageResponseSchema,
} from "@/domain/task/collection";
import { getAccountSummary } from "@/server/auth/session";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem, validationProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";
import { serializeTask, taskCreateFailureResponse } from "@/server/task/http";
import type { TaskService } from "@/server/task/service";

import { taskServiceFor } from "./service-factory";

export interface TasksRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => TaskService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: TasksRouteDependencies = {
  getAccountSummary,
  getService: taskServiceFor,
  createCorrelationId: correlationIdFrom,
};

export function createTasksRouteHandlers(deps: TasksRouteDependencies) {
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const url = new URL(request.url);
    const result = await deps.getService().listCollection(
      account.userId,
      {
        collection: url.searchParams.get("collection") ?? "anytime",
        // Callers must supply the account-local date; deriving it in UTC would
        // misclassify Today near timezone boundaries.
        today: url.searchParams.get("today"),
        areaId: url.searchParams.get("areaId"),
        energy: url.searchParams.get("energy"),
        cursor: url.searchParams.get("cursor"),
        direction: url.searchParams.get("direction") ?? undefined,
      },
      TASK_COLLECTION_PAGE_SIZE,
    );

    if (!result.ok) {
      return validationProblem(correlationId, result.fieldErrors);
    }

    return jsonResponse(
      taskCollectionPageResponseSchema.parse({
        items: result.items.map(serializeTask),
        nextCursor: result.nextCursor,
        previousCursor: result.previousCursor,
      }),
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
