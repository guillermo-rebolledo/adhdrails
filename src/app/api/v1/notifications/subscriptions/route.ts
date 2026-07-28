import {
  pushSubscriptionDeleteSchema,
  pushSubscriptionSchema,
} from "@/domain/notification/reminder";
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

export function createPushSubscriptionHandlers(deps: Dependencies) {
  async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);
    if (!account) return unauthorizedProblem(correlationId);
    const parsed = pushSubscriptionSchema.safeParse(
      await readJsonPayload(request),
    );
    if (!parsed.success) {
      return validationProblem(
        correlationId,
        parsed.error.flatten().fieldErrors,
      );
    }
    const id = await deps.getService().saveSubscription(account.userId, {
      id: parsed.data.id,
      endpoint: parsed.data.endpoint,
      expirationTime:
        parsed.data.expirationTime === null
          ? null
          : new Date(parsed.data.expirationTime),
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    });
    return jsonResponse({ id }, correlationId, 201);
  }

  async function DELETE(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);
    if (!account) return unauthorizedProblem(correlationId);
    const parsed = pushSubscriptionDeleteSchema.safeParse(
      await readJsonPayload(request),
    );
    if (!parsed.success) {
      return validationProblem(
        correlationId,
        parsed.error.flatten().fieldErrors,
      );
    }
    await deps.getService().removeSubscription(account.userId, parsed.data.id);
    return jsonResponse({ ok: true }, correlationId);
  }

  return { POST, DELETE };
}

const handlers = createPushSubscriptionHandlers(dependencies);
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
