import { type DataExportService } from "@/server/account/data-export-service";
import { getDataExportService } from "@/server/account/service-factory";
import { getAccountSummary } from "@/server/auth/session";
import {
  goneProblem,
  notFoundProblem,
  unauthorizedProblem,
} from "@/server/http/problem";
import {
  CORRELATION_ID_HEADER,
  correlationIdFrom,
} from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface DataExportDownloadRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => DataExportService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: DataExportDownloadRouteDependencies = {
  getAccountSummary,
  getService: getDataExportService,
  createCorrelationId: correlationIdFrom,
};

export function createDataExportDownloadRouteHandlers(
  deps: DataExportDownloadRouteDependencies,
) {
  /**
   * Streams the account's finished archive as a JSON attachment. A missing
   * archive is 404 and a closed download window is 410 Gone — distinct, honest
   * states so the UI never silently offers an unavailable file.
   */
  async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps.getService().getDownload(account.userId);

    if (!result.ok) {
      return result.reason === "expired"
        ? goneProblem(correlationId)
        : notFoundProblem(
            correlationId,
            "No data export is ready to download.",
          );
    }

    logOperationalEvent({
      correlationId,
      action: "account.data_export_downloaded",
      outcome: "success",
    });

    return new Response(result.payload, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${result.filename}"`,
        "cache-control": "no-store",
        [CORRELATION_ID_HEADER]: correlationId,
      },
    });
  }

  return { GET };
}

const handlers = createDataExportDownloadRouteHandlers(dependencies);

export const GET = handlers.GET;
