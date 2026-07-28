import { reminderPreferencesSchema } from "@/domain/notification/reminder";
import { getAccountSummary } from "@/server/auth/session";
import { getDatabase } from "@/server/db/connection";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem, validationProblem } from "@/server/http/problem";
import { createNotificationRepository } from "@/server/notification/repository";
import { correlationIdFrom } from "@/server/observability/correlation-id";

type Repository = ReturnType<typeof createNotificationRepository>;

interface Dependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getRepository: () => Repository;
  createCorrelationId: (request: Request) => string;
}

const dependencies: Dependencies = {
  getAccountSummary,
  getRepository: () => createNotificationRepository(getDatabase()),
  createCorrelationId: correlationIdFrom,
};

export function createNotificationPreferenceHandlers(deps: Dependencies) {
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);
    if (!account) return unauthorizedProblem(correlationId);
    return jsonResponse(
      await deps.getRepository().getPreferences(account.userId),
      correlationId,
    );
  }

  async function PUT(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);
    if (!account) return unauthorizedProblem(correlationId);

    const parsed = reminderPreferencesSchema.safeParse(
      await readJsonPayload(request),
    );
    if (!parsed.success) {
      return validationProblem(
        correlationId,
        parsed.error.flatten().fieldErrors,
      );
    }
    return jsonResponse(
      await deps.getRepository().savePreferences(account.userId, parsed.data),
      correlationId,
    );
  }

  return { GET, PUT };
}

const handlers = createNotificationPreferenceHandlers(dependencies);
export const GET = handlers.GET;
export const PUT = handlers.PUT;
