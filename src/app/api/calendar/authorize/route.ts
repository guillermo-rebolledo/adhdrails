import { getAccountSummary } from "@/server/auth/session";
import type { CalendarService } from "@/server/calendar/service";
import { getCalendarService } from "@/server/calendar/service-factory";
import {
  createOAuthState,
  safeReturnPath,
  setStateCookies,
} from "@/server/calendar/oauth-state";

export interface AuthorizeRouteDependencies {
  getAccountSummary: (headers: Headers) => Promise<{ userId: string } | null>;
  getService: () => CalendarService;
  createState: () => string;
}

const dependencies: AuthorizeRouteDependencies = {
  getAccountSummary,
  getService: getCalendarService,
  createState: createOAuthState,
};

function redirect(location: string, headers = new Headers()): Response {
  headers.set("location", location);
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers });
}

export function createAuthorizeRouteHandler(deps: AuthorizeRouteDependencies) {
  /**
   * Begins the incremental Calendar grant. It requires an authenticated account
   * (Calendar authorization is never a sign-in condition), stamps a CSRF state
   * into an HttpOnly cookie, remembers where to return, and redirects to Google.
   */
  return async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const account = await deps.getAccountSummary(request.headers);

    if (!account) {
      return redirect(new URL("/signin", url).toString());
    }

    const state = deps.createState();
    const returnPath = safeReturnPath(url.searchParams.get("return"));
    const authorizationUrl = deps.getService().buildAuthorizationUrl(state);

    const headers = new Headers();
    setStateCookies(headers, state, returnPath, {
      secure: url.protocol === "https:",
    });

    return redirect(authorizationUrl, headers);
  };
}

export const GET = createAuthorizeRouteHandler(dependencies);
