import { getAccountSummary } from "@/server/auth/session";
import {
  focusTransitionFailureResponse,
  serializeFocusSession,
} from "@/server/focus/http";
import type { FocusSessionService } from "@/server/focus/service";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

import { focusSessionServiceFor } from "../service-factory";

export interface FocusSessionItemRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => FocusSessionService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: FocusSessionItemRouteDependencies = {
  getAccountSummary,
  getService: focusSessionServiceFor,
  createCorrelationId: correlationIdFrom,
};

export function createFocusSessionItemRouteHandlers(
  deps: FocusSessionItemRouteDependencies,
) {
  async function PATCH(request: Request, id: string): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps
      .getService()
      .transition(account.userId, id, await readJsonPayload(request));

    if (!result.ok) {
      return focusTransitionFailureResponse(result, correlationId);
    }

    if (result.applied && result.item.status === "completed") {
      logOperationalEvent({
        correlationId,
        action: "focus_session.completed",
        outcome: "success",
      });
    }

    return jsonResponse(serializeFocusSession(result.item), correlationId);
  }

  return { PATCH };
}

const handlers = createFocusSessionItemRouteHandlers(dependencies);

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  return handlers.PATCH(request, id);
}
