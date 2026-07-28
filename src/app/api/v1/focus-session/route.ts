import { getAccountSummary } from "@/server/auth/session";
import {
  focusStartFailureResponse,
  serializeFocusSession,
} from "@/server/focus/http";
import type { FocusSessionService } from "@/server/focus/service";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

import { focusSessionServiceFor } from "./service-factory";

export interface FocusSessionRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => FocusSessionService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: FocusSessionRouteDependencies = {
  getAccountSummary,
  getService: focusSessionServiceFor,
  createCorrelationId: correlationIdFrom,
};

export function createFocusSessionRouteHandlers(
  deps: FocusSessionRouteDependencies,
) {
  /** The account's active session for cross-device hydration, or `null`. */
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const active = await deps.getService().getActive(account.userId);
    return jsonResponse(
      { session: active ? serializeFocusSession(active) : null },
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
      .start(account.userId, await readJsonPayload(request));

    if (!result.ok) {
      return focusStartFailureResponse(result, correlationId);
    }

    if (result.created) {
      logOperationalEvent({
        correlationId,
        action: "focus_session.started",
        outcome: "success",
      });
    }

    return jsonResponse(
      serializeFocusSession(result.item),
      correlationId,
      result.created ? 201 : 200,
    );
  }

  return { GET, POST };
}

const handlers = createFocusSessionRouteHandlers(dependencies);

export const GET = handlers.GET;
export const POST = handlers.POST;
