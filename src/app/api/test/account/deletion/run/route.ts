import { getAccountDeletionRepository } from "@/server/account/service-factory";
import {
  getCalendarService,
  revokeGoogleProviderToken,
} from "@/server/calendar/service-factory";
import { readJsonPayload } from "@/server/http/json";
import { runAccountDeletionJob } from "@/server/account/run-account-deletion-job";

/**
 * Test-only durable-job driver. Production uses Inngest; Playwright uses this
 * route to deterministically wait for the same job body to finish.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.APP_ENV !== "test") {
    return new Response(null, { status: 404 });
  }

  const body = (await readJsonPayload(request)) as
    | { jobId?: unknown }
    | undefined;
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  if (!jobId) {
    return Response.json({ error: "jobId is required" }, { status: 422 });
  }

  const result = await runAccountDeletionJob(
    {
      repository: getAccountDeletionRepository(),
      disconnectCalendar: (userId) =>
        getCalendarService().disconnectForAccountDeletion(userId),
      revokeProviderToken: revokeGoogleProviderToken,
    },
    jobId,
  );
  return Response.json(result);
}
