import { getAccountSummary } from "@/server/auth/session";
import { serializeConnection } from "@/server/calendar/http";
import {
  type CalendarService,
  createCalendarService,
} from "@/server/calendar/service";
import { getCalendarService } from "@/server/calendar/service-factory";
import { jsonResponse } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface CalendarConnectionRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => CalendarService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: CalendarConnectionRouteDependencies = {
  getAccountSummary,
  getService: getCalendarService,
  createCorrelationId: correlationIdFrom,
};

export function createCalendarConnectionRouteHandlers(
  deps: CalendarConnectionRouteDependencies,
) {
  /** Returns the account's Calendar connection, or `{ connection: null }`. */
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const connection = await deps.getService().getConnection(account.userId);

    return jsonResponse(
      { connection: connection ? serializeConnection(connection) : null },
      correlationId,
    );
  }

  /** Disconnects Calendar. Login and local Events are left untouched. */
  async function DELETE(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps.getService().disconnect(account.userId);

    if (result.wasConnected) {
      logOperationalEvent({
        correlationId,
        action: "calendar.disconnected",
        outcome: "success",
      });
    }

    return jsonResponse({ wasConnected: result.wasConnected }, correlationId);
  }

  return { GET, DELETE };
}

const handlers = createCalendarConnectionRouteHandlers(dependencies);

export const GET = handlers.GET;
export const DELETE = handlers.DELETE;

// Re-exported so tests can build a service over a fake repository/adapter.
export { createCalendarService };
