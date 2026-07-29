import { getAccountSummary } from "@/server/auth/session";
import { saveSelectionFailureResponse } from "@/server/calendar/http";
import type { CalendarService } from "@/server/calendar/service";
import { getCalendarService } from "@/server/calendar/service-factory";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { notFoundProblem, unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface CalendarSelectionRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => CalendarService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: CalendarSelectionRouteDependencies = {
  getAccountSummary,
  getService: getCalendarService,
  createCorrelationId: correlationIdFrom,
};

export function createCalendarSelectionRouteHandlers(
  deps: CalendarSelectionRouteDependencies,
) {
  /** Saves which calendars are visible and which single calendar is writable. */
  async function PUT(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps
      .getService()
      .saveSelection(account.userId, await readJsonPayload(request));

    if (!result.ok) {
      if (result.reason === "not_connected") {
        return notFoundProblem(
          correlationId,
          "Google Calendar is not connected.",
        );
      }
      return saveSelectionFailureResponse(result, correlationId);
    }

    logOperationalEvent({
      correlationId,
      action: "calendar.selection_saved",
      outcome: "success",
    });

    return jsonResponse({ calendars: result.calendars }, correlationId);
  }

  return { PUT };
}

const handlers = createCalendarSelectionRouteHandlers(dependencies);

export const PUT = handlers.PUT;
