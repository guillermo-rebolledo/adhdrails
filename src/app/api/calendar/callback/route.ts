import { getAccountSummary } from "@/server/auth/session";
import type { CalendarService } from "@/server/calendar/service";
import { getCalendarService } from "@/server/calendar/service-factory";
import {
  RETURN_COOKIE,
  STATE_COOKIE,
  clearStateCookies,
  parseCookies,
  safeReturnPath,
} from "@/server/calendar/oauth-state";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface CallbackRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => CalendarService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: CallbackRouteDependencies = {
  getAccountSummary,
  getService: getCalendarService,
  createCorrelationId: correlationIdFrom,
};

/** Appends a `calendar` status to the return path so Settings can show a cue. */
function returnWith(
  base: URL,
  returnPath: string,
  outcome: "connected" | "denied" | "error",
  headers: Headers,
): Response {
  const target = new URL(returnPath, base);
  target.searchParams.set("calendar", outcome);
  headers.set("location", target.toString());
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers });
}

export function createCallbackRouteHandler(deps: CallbackRouteDependencies) {
  /**
   * Completes the incremental grant. It verifies the CSRF state against its
   * cookie, then exchanges the code and persists an encrypted connection. Every
   * outcome — denial, state mismatch, exchange failure, success — returns the
   * user to Settings with a calm status cue and never affects their login.
   */
  return async function GET(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const url = new URL(request.url);
    const cookies = parseCookies(request.headers.get("cookie"));
    const returnPath = safeReturnPath(cookies.get(RETURN_COOKIE) ?? null);

    const headers = new Headers();
    clearStateCookies(headers, { secure: url.protocol === "https:" });

    const account = await deps.getAccountSummary(request.headers);
    if (!account) {
      headers.set("location", new URL("/signin", url).toString());
      headers.set("cache-control", "no-store");
      return new Response(null, { status: 302, headers });
    }

    if (url.searchParams.get("error")) {
      // The user declined consent. Local Events and the account keep working.
      return returnWith(url, returnPath, "denied", headers);
    }

    const state = url.searchParams.get("state");
    const expectedState = cookies.get(STATE_COOKIE);
    const code = url.searchParams.get("code");

    if (!state || !expectedState || state !== expectedState || !code) {
      logOperationalEvent({
        correlationId,
        action: "calendar.authorization_rejected",
        outcome: "failure",
        safeCode: "state_mismatch",
      });
      return returnWith(url, returnPath, "error", headers);
    }

    const result = await deps
      .getService()
      .completeAuthorization(account.userId, code);

    if (!result.ok) {
      logOperationalEvent({
        correlationId,
        action: "calendar.authorization_failed",
        outcome: "failure",
        safeCode: result.reason,
      });
      return returnWith(url, returnPath, "error", headers);
    }

    logOperationalEvent({
      correlationId,
      action: "calendar.connected",
      outcome: "success",
    });

    return returnWith(url, returnPath, "connected", headers);
  };
}

export const GET = createCallbackRouteHandler(dependencies);
