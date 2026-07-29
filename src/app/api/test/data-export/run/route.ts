import { runDataExportJob } from "@/server/account/run-data-export-job";
import { getDataExportRepository } from "@/server/account/service-factory";
import { getAccountSummary } from "@/server/auth/session";

/**
 * Test-only export runner. Mounted only when `APP_ENV=test`, it stands in for the
 * durable Inngest exporter so Playwright can drive the request → generate →
 * download flow end to end without an Inngest dev server. It runs the signed-in
 * account's latest pending export to completion using the exact production job
 * body, so the e2e exercises the real code path.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.APP_ENV !== "test") {
    return new Response("Not found", { status: 404 });
  }

  const account = await getAccountSummary(request.headers);
  if (!account) {
    return new Response("Unauthorized", { status: 401 });
  }

  const repository = getDataExportRepository();
  const [pending] = await repository.listPending(1);
  if (!pending || pending.userId !== account.userId) {
    return Response.json({ ran: false }, { status: 200 });
  }

  const result = await runDataExportJob({ repository }, pending.id);
  return Response.json({ ran: true, result }, { status: 200 });
}
