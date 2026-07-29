import {
  type DataExportService,
  createDataExportService,
} from "@/server/account/data-export-service";
import { getDataExportService } from "@/server/account/service-factory";
import { getAccountSummary } from "@/server/auth/session";
import { jsonResponse } from "@/server/http/json";
import { unauthorizedProblem } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface DataExportRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => DataExportService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: DataExportRouteDependencies = {
  getAccountSummary,
  getService: getDataExportService,
  createCorrelationId: correlationIdFrom,
};

export function createDataExportRouteHandlers(
  deps: DataExportRouteDependencies,
) {
  /** The account's latest export status, or `none` if never requested. */
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const status = await deps.getService().getStatus(account.userId);
    return jsonResponse(status, correlationId);
  }

  /**
   * Requests an export. Idempotent while one is in flight: a repeat request
   * re-arms the existing job (200) rather than enqueuing a second, and a fresh
   * request is accepted for durable background work (202). The response is the
   * current status, so the caller never blocks on generation.
   */
  async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps.getService().requestExport(account.userId);

    logOperationalEvent({
      correlationId,
      action: "account.data_export_requested",
      outcome: "success",
      safeCode: result.created ? "created" : "rearmed",
    });

    return jsonResponse(
      result.status,
      correlationId,
      result.created ? 202 : 200,
    );
  }

  return { GET, POST };
}

const handlers = createDataExportRouteHandlers(dependencies);

export const GET = handlers.GET;
export const POST = handlers.POST;

// Re-exported so tests can build a service over a fake repository/dispatcher.
export { createDataExportService };
