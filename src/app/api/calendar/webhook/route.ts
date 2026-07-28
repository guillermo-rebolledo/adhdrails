import type { RawNotificationHeaders } from "@/domain/calendar/notification";
import type { CalendarWebhookService } from "@/server/calendar/webhook-service";
import { getCalendarWebhookService } from "@/server/calendar/service-factory";
import { correlationIdFrom } from "@/server/observability/correlation-id";
import { logOperationalEvent } from "@/server/observability/logger";

export interface WebhookRouteDependencies {
  getService: () => CalendarWebhookService;
  createCorrelationId: (request: Request) => string;
}

const dependencies: WebhookRouteDependencies = {
  getService: getCalendarWebhookService,
  createCorrelationId: correlationIdFrom,
};

/** Extracts the Google push-notification headers (all case-insensitive). */
function notificationHeaders(headers: Headers): RawNotificationHeaders {
  return {
    channelId: headers.get("x-goog-channel-id"),
    token: headers.get("x-goog-channel-token"),
    resourceId: headers.get("x-goog-resource-id"),
    resourceState: headers.get("x-goog-resource-state"),
    messageNumber: headers.get("x-goog-message-number"),
  };
}

export function createCalendarWebhookRouteHandlers(
  deps: WebhookRouteDependencies,
) {
  /**
   * Receives Google Calendar push notifications. It verifies the channel token
   * and acknowledges quickly — it never contacts Google inline; a verified change
   * only records a durable outbox job and hands it to the durable runner. The
   * notification body is intentionally never read, and only safe metadata (the
   * outcome and correlation id) is logged, so provider payloads and user content
   * never reach a log. A 200 stops Google's re-delivery; a 404 tells Google to
   * stop an unrecognized or unverifiable channel.
   */
  async function POST(request: Request): Promise<Response> {
    const correlationId = deps.createCorrelationId(request);
    const outcome = await deps
      .getService()
      .handleNotification(notificationHeaders(request.headers));

    if (outcome.kind === "unverified") {
      logOperationalEvent({
        correlationId,
        action: "calendar.webhook_rejected",
        outcome: "failure",
        safeCode: "unverified_channel",
      });
      // Tell Google to stop delivering to a channel Rails cannot verify.
      return new Response(null, { status: 404 });
    }

    logOperationalEvent({
      correlationId,
      action: "calendar.webhook_received",
      outcome: "success",
      safeCode: outcome.kind,
    });

    // Every recognized notification is acknowledged with 200 so Google stops
    // re-delivering; the durable job carries the actual synchronization forward.
    return new Response(null, { status: 200 });
  }

  return { POST };
}

const handlers = createCalendarWebhookRouteHandlers(dependencies);

export const POST = handlers.POST;
