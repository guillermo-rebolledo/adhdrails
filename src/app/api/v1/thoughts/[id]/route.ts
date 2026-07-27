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

type Context = { params: Promise<{ id: string }> };
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

export function createThoughtItemHandlers(deps: Dependencies) {
  async function account(request: Request, correlationId: string) {
    return deps
      .getAccountSummary(request.headers)
      .then((value) => (value ? value : unauthorizedProblem(correlationId)));
  }

  async function GET(request: Request, context: Context): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const scoped = await account(request, correlationId);
    if (scoped instanceof Response) return scoped;
    const result = await deps
      .getService()
      .get(scoped.userId, (await context.params).id);
    return result.ok
      ? jsonResponse(serializeThought(result.thought), correlationId)
      : thoughtFailureResponse(result, correlationId);
  }

  async function PATCH(request: Request, context: Context): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const scoped = await account(request, correlationId);
    if (scoped instanceof Response) return scoped;
    const result = await deps
      .getService()
      .update(
        scoped.userId,
        (await context.params).id,
        await readJsonPayload(request),
      );
    return result.ok
      ? jsonResponse(serializeThought(result.thought), correlationId)
      : thoughtFailureResponse(result, correlationId);
  }

  async function DELETE(request: Request, context: Context): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const scoped = await account(request, correlationId);
    if (scoped instanceof Response) return scoped;
    const result = await deps
      .getService()
      .setDeleted(
        scoped.userId,
        (await context.params).id,
        await readJsonPayload(request),
      );
    return result.ok
      ? jsonResponse(serializeThought(result.thought), correlationId)
      : thoughtFailureResponse(result, correlationId);
  }

  return { GET, PATCH, DELETE };
}

const handlers = createThoughtItemHandlers(dependencies);
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
