import { testNotificationSchema } from "@/domain/notification/reminder";
import { getAccountSummary } from "@/server/auth/session";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import {
  goneProblem,
  notFoundProblem,
  pushUnavailableProblem,
  unauthorizedProblem,
  validationProblem,
} from "@/server/http/problem";
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

export function createTestNotificationHandler(deps: Dependencies) {
  return async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);
    if (!account) return unauthorizedProblem(correlationId);
    const parsed = testNotificationSchema.safeParse(
      await readJsonPayload(request),
    );
    if (!parsed.success) {
      return validationProblem(
        correlationId,
        parsed.error.flatten().fieldErrors,
      );
    }
    const outcome = await deps
      .getService()
      .sendTest(account.userId, parsed.data.subscriptionId);
    if (outcome === "not_found") return notFoundProblem(correlationId);
    if (outcome === "expired") return goneProblem(correlationId);
    if (outcome === "unavailable") return pushUnavailableProblem(correlationId);
    return jsonResponse({ ok: true }, correlationId);
  };
}

export const POST = createTestNotificationHandler(dependencies);
