import { reminderPreferencesSchema } from "@/domain/notification/reminder";
import { getAccountSummary } from "@/server/auth/session";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import { unauthorizedProblem, validationProblem } from "@/server/http/problem";
import type { NotificationService } from "@/server/notification/service";
import { getNotificationService } from "@/server/notification/service-factory";
import { correlationIdFrom } from "@/server/observability/correlation-id";

interface Dependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => NotificationService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: Dependencies = {
  getAccountSummary,
  getService: getNotificationService,
  createCorrelationId: correlationIdFrom,
};

export function createNotificationPreferenceHandlers(deps: Dependencies) {
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);
    if (!account) return unauthorizedProblem(correlationId);
    return jsonResponse(
      await deps.getService().getPreferences(account.userId),
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
      await deps.getService().savePreferences(account.userId, parsed.data),
      correlationId,
    );
  }

  return { GET, PUT };
}

const handlers = createNotificationPreferenceHandlers(dependencies);
export const GET = handlers.GET;
export const PUT = handlers.PUT;
