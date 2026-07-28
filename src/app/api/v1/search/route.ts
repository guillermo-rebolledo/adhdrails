import { searchPageSchema, searchQuerySchema } from "@/domain/search/search";
import { getAccountSummary } from "@/server/auth/session";
import { getDatabase } from "@/server/db/connection";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem, validationProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";
import { createSearchRepository } from "@/server/search/repository";
import {
  createSearchService,
  type SearchService,
} from "@/server/search/service";

interface Dependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => SearchService;
  createCorrelationId: (request: Request) => string;
  now: () => number;
  recordCompletion: (input: {
    correlationId: string;
    durationMs: number;
  }) => void;
}

const dependencies: Dependencies = {
  getAccountSummary,
  getService: () => createSearchService(createSearchRepository(getDatabase())),
  createCorrelationId: correlationIdFrom,
  now: () => performance.now(),
  recordCompletion: ({ correlationId, durationMs }) =>
    logOperationalEvent({
      correlationId,
      action: "search.completed",
      outcome: "success",
      durationMs,
    }),
};

export function createSearchRouteHandler(deps: Dependencies) {
  return async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);
    if (!account) return unauthorizedProblem(correlationId);

    const parsed = searchQuerySchema.safeParse(await readJsonPayload(request));
    if (!parsed.success) {
      return validationProblem(correlationId, {
        q: ["Enter between 1 and 200 characters."],
      });
    }

    const startedAt = deps.now();
    const page = await deps.getService().search(account.userId, {
      query: parsed.data.query,
      cursor: parsed.data.cursor,
    });
    deps.recordCompletion({
      correlationId,
      durationMs: deps.now() - startedAt,
    });
    return jsonResponse(searchPageSchema.parse(page), correlationId);
  };
}

const POST = createSearchRouteHandler(dependencies);
export { POST };
