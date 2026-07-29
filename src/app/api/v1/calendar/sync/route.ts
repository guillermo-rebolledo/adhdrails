import { getAccountSummary } from "@/server/auth/session";
import type { CalendarImportService } from "@/server/calendar/import-service";
import {
  getCalendarImportService,
  getCalendarWatchService,
} from "@/server/calendar/service-factory";
import type { CalendarWatchService } from "@/server/calendar/watch-service";
import { jsonResponse } from "@/server/http/json";
import {
  calendarReauthProblem,
  notFoundProblem,
  unauthorizedProblem,
} from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface CalendarSyncRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => CalendarImportService;
  getWatchService: () => CalendarWatchService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: CalendarSyncRouteDependencies = {
  getAccountSummary,
  getService: getCalendarImportService,
  getWatchService: getCalendarWatchService,
  createCorrelationId: correlationIdFrom,
};

export function createCalendarSyncRouteHandlers(
  deps: CalendarSyncRouteDependencies,
) {
  /**
   * Runs the bounded initial import of the account's visible calendars into the
   * local mirror (MEM-40) and returns the counts and last-synchronized instant.
   * Idempotent: a repeated call re-upserts by provider identity without
   * duplicating Events, so the client may safely retry.
   */
  async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return unauthorizedProblem(correlationId);
    }

    const result = await deps.getService().importMirror(account.userId);

    if (!result.ok) {
      logOperationalEvent({
        correlationId,
        action: "calendar.synced",
        outcome: "failure",
      });
      if (result.reason === "not_connected") {
        return notFoundProblem(
          correlationId,
          "Google Calendar is not connected.",
        );
      }
      return calendarReauthProblem(correlationId);
    }

    // Register (or renew) a push-notification watch per visible calendar so
    // subsequent changes arrive incrementally (MEM-41). Best-effort: a watch
    // failure must not fail the import the user just completed — periodic
    // reconciliation is the backstop when watches are missing.
    try {
      await deps.getWatchService().ensureWatches(account.userId);
    } catch {
      logOperationalEvent({
        correlationId,
        action: "calendar.watch_renewal",
        outcome: "failure",
        safeCode: "watch_registration_failed",
      });
    }

    logOperationalEvent({
      correlationId,
      action: "calendar.synced",
      outcome: "success",
    });

    return jsonResponse(
      {
        imported: result.imported,
        removed: result.removed,
        lastSyncedAt: result.lastSyncedAt,
      },
      correlationId,
    );
  }

  return { POST };
}

const handlers = createCalendarSyncRouteHandlers(dependencies);

export const POST = handlers.POST;
