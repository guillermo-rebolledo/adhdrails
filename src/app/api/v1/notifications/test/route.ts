import {
  safeTestPushPayload,
  testNotificationSchema,
} from "@/domain/notification/reminder";
import { getAccountSummary } from "@/server/auth/session";
import { getDatabase } from "@/server/db/connection";
import { jsonResponse, readJsonPayload } from "@/server/http/json";
import {
  goneProblem,
  notFoundProblem,
  pushUnavailableProblem,
  unauthorizedProblem,
  validationProblem,
} from "@/server/http/problem";
import { readWebPushConfig } from "@/server/notification/env";
import { createNotificationRepository } from "@/server/notification/repository";
import type { PushAdapter } from "@/server/notification/reminder-service";
import { createWebPushAdapter } from "@/server/notification/web-push-adapter";
import { correlationIdFrom } from "@/server/observability/correlation-id";

type Repository = ReturnType<typeof createNotificationRepository>;

interface Dependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getRepository: () => Repository;
  getPushAdapter: () => PushAdapter;
  createCorrelationId: (request: Request) => string;
}

const dependencies: Dependencies = {
  getAccountSummary,
  getRepository: () => createNotificationRepository(getDatabase()),
  getPushAdapter: () => createWebPushAdapter(readWebPushConfig()),
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
    const repository = deps.getRepository();
    const subscription = await repository.getSubscription(
      account.userId,
      parsed.data.subscriptionId,
    );
    if (!subscription) return notFoundProblem(correlationId);

    try {
      const outcome = await deps
        .getPushAdapter()
        .send(subscription, JSON.stringify(safeTestPushPayload()));
      if (outcome === "expired") {
        await repository.deleteSubscription(account.userId, subscription.id);
        return goneProblem(correlationId);
      }
      return jsonResponse({ ok: true }, correlationId);
    } catch {
      return pushUnavailableProblem(correlationId);
    }
  };
}

export const POST = createTestNotificationHandler(dependencies);
