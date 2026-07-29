import { getAccountSummary } from "@/server/auth/session";
import { getDatabase } from "@/server/db/connection";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import {
  serializeThought,
  thoughtFailureResponse,
} from "@/server/thought/http";
import { createThoughtRepository } from "@/server/thought/repository";
import {
  createThoughtService,
  type ThoughtService,
} from "@/server/thought/service";

interface Dependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => ThoughtService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: Dependencies = {
  getAccountSummary,
  getService: () =>
    createThoughtService(createThoughtRepository(getDatabase())),
  createCorrelationId: correlationIdFrom,
};

export function createThoughtCollectionHandlers(deps: Dependencies) {
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);
    if (!account) return unauthorizedProblem(correlationId);
    const thoughts = await deps.getService().listForAccount(account.userId);
    return jsonResponse(
      { thoughts: thoughts.map(serializeThought) },
      correlationId,
    );
  }

  async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);
    if (!account) return unauthorizedProblem(correlationId);
    const result = await deps
      .getService()
      .create(account.userId, await readJsonPayload(request));
    return result.ok
      ? jsonResponse(
          serializeThought(result.thought),
          correlationId,
          result.created ? 201 : 200,
        )
      : thoughtFailureResponse(result, correlationId);
  }

  return { GET, POST };
}

const handlers = createThoughtCollectionHandlers(dependencies);
export const GET = handlers.GET;
export const POST = handlers.POST;
