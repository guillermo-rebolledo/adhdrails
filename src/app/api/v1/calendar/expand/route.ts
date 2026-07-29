import { getAccountSummary } from "@/server/auth/session";
import type { CalendarMaintenanceService } from "@/server/calendar/maintenance-service";
import { getCalendarMaintenanceService } from "@/server/calendar/service-factory";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import {
  notFoundProblem,
  unauthorizedProblem,
  validationProblem,
} from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface CalendarExpandRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => CalendarMaintenanceService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: CalendarExpandRouteDependencies = {
  getAccountSummary,
  getService: getCalendarMaintenanceService,
  createCorrelationId: correlationIdFrom,
};

export function createCalendarExpandRouteHandlers(
  deps: CalendarExpandRouteDependencies,
) {
  /**
   * On-demand range expansion (MEM-43): brings the account's visible calendars
   * current over the default window stretched forward to the requested `through`
   * instant, for when the client browses the Later list past the default 12-month
   * horizon. Additive and idempotent — expansion upserts by provider identity and
   * never advances a cursor — so the client may safely retry and current agenda
   * data is preserved. The service validates the request body; the route only
   * authenticates and translates the outcome to HTTP.
   */
  async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps
      .getService()
      .expandForAccount(account.userId, await readJsonPayload(request));

    if (!result.ok) {
      if (result.reason === "invalid_shape") {
        return validationProblem(correlationId, result.fieldErrors);
      }
      logOperationalEvent({
        correlationId,
        action: "calendar.range_expanded",
        outcome: "failure",
      });
      return notFoundProblem(
        correlationId,
        "Google Calendar is not connected.",
      );
    }

    logOperationalEvent({
      correlationId,
      action: "calendar.range_expanded",
      outcome: result.failures > 0 ? "failure" : "success",
      safeCode: result.failures > 0 ? "partial_failure" : undefined,
    });

    return jsonResponse(
      {
        calendars: result.calendars,
        changed: result.changed,
        removed: result.removed,
      },
      correlationId,
    );
  }

  return { POST };
}

const handlers = createCalendarExpandRouteHandlers(dependencies);

export const POST = handlers.POST;
