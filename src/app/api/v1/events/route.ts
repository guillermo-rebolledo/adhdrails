import { getAccountSummary } from "@/server/auth/session";
import {
  eventCreateFailureResponse,
  serializeEvent,
} from "@/server/event/http";
import { getEventService } from "@/server/event/service-factory";
import { type EventService } from "@/server/event/service";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem, validationProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface EventsRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => EventService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: EventsRouteDependencies = {
  getAccountSummary,
  getService: getEventService,
  createCorrelationId: correlationIdFrom,
};

/** Parses an ISO instant query param into a Date, or null if absent/invalid. */
function parseInstant(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function createEventsRouteHandlers(deps: EventsRouteDependencies) {
  /**
   * Lists Events whose start falls in the half-open window `[from, to)`. The
   * client computes the agenda week's bounds in the user's time zone and passes
   * them as instants, so the server stays time-zone-agnostic.
   */
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const url = new URL(request.url);
    const from = parseInstant(url.searchParams.get("from"));
    const to = parseInstant(url.searchParams.get("to"));

    if (!from || !to) {
      return validationProblem(correlationId, {
        from: from ? [] : ["A valid `from` instant is required."],
        to: to ? [] : ["A valid `to` instant is required."],
      });
    }

    const items = await deps
      .getService()
      .listInWindow(account.userId, from, to);

    return jsonResponse({ items: items.map(serializeEvent) }, correlationId);
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
      return eventCreateFailureResponse(result, correlationId);
    }

    if (result.created) {
      logOperationalEvent({
        correlationId,
        action: "event.created",
        outcome: "success",
      });
    }

    return jsonResponse(
      serializeEvent(result.item),
      correlationId,
      result.created ? 201 : 200,
    );
  }

  return { GET, POST };
}

const handlers = createEventsRouteHandlers(dependencies);

export const GET = handlers.GET;
export const POST = handlers.POST;
