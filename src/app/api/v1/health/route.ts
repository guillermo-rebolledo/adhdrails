import {
  CORRELATION_ID_HEADER,
  correlationIdFrom,
} from "@/server/observability/correlation-id";
import { checkDatabase } from "@/server/db/health";
import { problemResponse } from "@/server/http/problem";
import { logOperationalEvent } from "@/server/observability/logger";

interface HealthDependencies {
  checkDatabase: () => Promise<void>;
  createCorrelationId: (request: Request) => string;
}

const dependencies: HealthDependencies = {
  checkDatabase,
  createCorrelationId: correlationIdFrom,
};

export function createHealthHandler({
  checkDatabase,
  createCorrelationId,
}: HealthDependencies) {
  return async function health(request: Request): Promise<Response> {
    const correlationId = createCorrelationId(request);

    try {
      await checkDatabase();
    } catch {
      logOperationalEvent({
        correlationId,
        action: "health.database_check",
        outcome: "failure",
        safeCode: "database_unavailable",
      });

      return problemResponse({
        type: "https://rails.app/problems/database-unavailable",
        title: "Service unavailable",
        status: 503,
        code: "database_unavailable",
        detail: "Rails cannot reach its database right now.",
        correlationId,
        retryable: true,
      });
    }

    logOperationalEvent({
      correlationId,
      action: "health.database_check",
      outcome: "success",
    });

    return Response.json(
      {
        status: "ok",
        checks: {
          application: "ok",
          database: "ok",
        },
        correlationId,
      },
      {
        headers: {
          [CORRELATION_ID_HEADER]: correlationId,
          "cache-control": "no-store",
        },
      },
    );
  };
}

export const GET = createHealthHandler(dependencies);
