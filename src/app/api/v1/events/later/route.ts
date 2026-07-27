import { LATER_PAGE_SIZE } from "@/domain/calendar/later";
import { getDatabase } from "@/server/db/connection";
import { getAccountSummary } from "@/server/auth/session";
import { serializeEvent } from "@/server/event/http";
import { createEventRepository } from "@/server/event/repository";
import { type EventService, createEventService } from "@/server/event/service";
import { jsonResponse } from "@/server/http/json";
import { unauthorizedProblem, validationProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";

export interface LaterEventsRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => EventService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: LaterEventsRouteDependencies = {
  getAccountSummary,
  getService: () => createEventService(createEventRepository(getDatabase())),
  createCorrelationId: correlationIdFrom,
};

export function createLaterEventsRouteHandlers(
  deps: LaterEventsRouteDependencies,
) {
  /**
   * One cursor page of the Later list — Events starting on or after `from`
   * (the instant just past the current agenda week, computed by the client in
   * the user's time zone). `cursor` resumes a previous page; `limit` is
   * clamped to the default page size so a caller can't request an unbounded
   * page. Returns `{ items, nextCursor }` for `useInfiniteQuery`.
   */
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const url = new URL(request.url);
    const fromParam = url.searchParams.get("from");
    const from = fromParam ? new Date(fromParam) : null;

    if (!from || Number.isNaN(from.getTime())) {
      return validationProblem(correlationId, {
        from: ["A valid `from` instant is required."],
      });
    }

    const cursor = url.searchParams.get("cursor");
    const page = await deps
      .getService()
      .listLater(account.userId, from, cursor, LATER_PAGE_SIZE);

    return jsonResponse(
      {
        items: page.items.map(serializeEvent),
        nextCursor: page.nextCursor,
      },
      correlationId,
    );
  }

  return { GET };
}

const handlers = createLaterEventsRouteHandlers(dependencies);

export const GET = handlers.GET;
