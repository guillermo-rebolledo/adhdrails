import { searchPageSchema, searchQuerySchema } from "@/domain/search/search";
import { getAccountSummary } from "@/server/auth/session";
import { getDatabase } from "@/server/db/connection";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem, validationProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { createSearchRepository } from "@/server/search/repository";

interface Dependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  search: (
    userId: string,
    input: { query: string; cursor?: string },
  ) => Promise<unknown>;
  createCorrelationId: (request: Request) => string;
}

const dependencies: Dependencies = {
  getAccountSummary,
  search: (userId, input) =>
    createSearchRepository(getDatabase()).search(
      userId,
      input.query,
      input.cursor,
    ),
  createCorrelationId: correlationIdFrom,
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

    const page = await deps.search(account.userId, {
      query: parsed.data.query,
      cursor: parsed.data.cursor,
    });
    return jsonResponse(searchPageSchema.parse(page), correlationId);
  };
}

const POST = createSearchRouteHandler(dependencies);
export { POST };
