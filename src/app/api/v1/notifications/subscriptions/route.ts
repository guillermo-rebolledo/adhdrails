import {
  pushSubscriptionDeleteSchema,
  pushSubscriptionSchema,
} from "@/domain/notification/reminder";
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
    await deps.getRepository().saveSubscription(account.userId, {
      id: parsed.data.id,
      endpoint: parsed.data.endpoint,
      expirationTime:
        parsed.data.expirationTime === null
          ? null
          : new Date(parsed.data.expirationTime),
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    });
    return jsonResponse({ ok: true }, correlationId, 201);
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
    await deps
      .getRepository()
      .deleteSubscription(account.userId, parsed.data.id);
    return jsonResponse({ ok: true }, correlationId);
  }

  return { POST, DELETE };
}

const handlers = createPushSubscriptionHandlers(dependencies);
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
