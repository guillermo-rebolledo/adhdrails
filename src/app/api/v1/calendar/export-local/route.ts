import { getAccountSummary } from "@/server/auth/session";
import type { ExportLocalService } from "@/server/calendar/export-local-service";
import { getExportLocalService } from "@/server/calendar/service-factory";
import { jsonResponse } from "@/server/http/json";
import { notFoundProblem, unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface ExportLocalRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => ExportLocalService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: ExportLocalRouteDependencies = {
  getAccountSummary,
  getService: getExportLocalService,
  createCorrelationId: correlationIdFrom,
};

export function createExportLocalRouteHandlers(
  deps: ExportLocalRouteDependencies,
) {
  /**
   * The explicit export-on-reconnect action (MEM-42, user story 93): enqueues an
   * export for every local Event not yet mirrored to Google. Requires a writable
   * calendar; a reconnect never writes to Google without this deliberate choice.
   * Idempotent: the outbox re-arms rather than duplicating, so a repeated call is
   * safe.
   */
  async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps.getService().exportLocalEvents(account.userId);

    if (!result.ok) {
      logOperationalEvent({
        correlationId,
        action: "calendar.local_export_requested",
        outcome: "failure",
        safeCode: result.reason,
      });
      return notFoundProblem(
        correlationId,
        "Select a writable Google calendar before exporting local events.",
      );
    }

    logOperationalEvent({
      correlationId,
      action: "calendar.local_export_requested",
      outcome: "success",
    });

    return jsonResponse({ enqueued: result.enqueued }, correlationId);
  }

  return { POST };
}

const handlers = createExportLocalRouteHandlers(dependencies);

export const POST = handlers.POST;
