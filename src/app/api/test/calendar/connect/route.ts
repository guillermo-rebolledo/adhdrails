import { getAccountSummary } from "@/server/auth/session";
import { getCalendarService } from "@/server/calendar/service-factory";

/**
 * Test-only Calendar connect helper. Mounted only when `APP_ENV=test`, it runs
 * the real `completeAuthorization` use case for the signed-in account, which the
 * service-factory backs with the in-memory Google adapter in that runtime. This
 * lets Playwright exercise the full connect/configure/disconnect flow against
 * the Google adapter seam without a live OAuth redirect.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.APP_ENV !== "test") {
    return new Response("Not found", { status: 404 });
  }

  const account = await getAccountSummary(request.headers);
  if (!account) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await getCalendarService().completeAuthorization(
    account.userId,
    `test-code-${crypto.randomUUID()}`,
  );

  return Response.json(result, { status: result.ok ? 200 : 500 });
}
