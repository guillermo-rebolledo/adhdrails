import {
  channelTokenMatches,
  interpretCalendarNotification,
  type RawNotificationHeaders,
} from "@/domain/calendar/notification";

import type { CalendarRepository } from "./repository";
import type { SyncJobDispatcher } from "./sync-dispatcher";
import type { CalendarSyncJobRepository } from "./sync-job-repository";

export interface CalendarWebhookDependencies {
  calendarRepository: CalendarRepository;
  syncJobRepository: CalendarSyncJobRepository;
  dispatcher: SyncJobDispatcher;
}

/**
 * The outcome of handling one notification, which the route maps to a status:
 * - `handshake` — Google's one-time delivery confirmation; acknowledge (200).
 * - `accepted` — verified change; a durable job was recorded and dispatched (200).
 * - `ignored` — a well-formed notification with nothing to act on (200).
 * - `invalid` — malformed headers; acknowledge so Google stops retrying (200).
 * - `unverified` — unknown channel or token mismatch; tell Google to stop (404).
 */
export type WebhookOutcome =
  | { kind: "handshake" }
  | { kind: "accepted"; enqueued: boolean; jobId: string }
  | { kind: "ignored"; reason: string }
  | { kind: "invalid"; reason: string }
  | { kind: "unverified" };

/**
 * Verifies and acknowledges Google Calendar push notifications without doing any
 * provider synchronization inline (MEM-41). A verified change records exactly one
 * durable outbox job — idempotent on `(channel, message number)`, so a
 * re-delivery never enqueues twice — and hands it to the dispatcher for the
 * Inngest incremental sync. A notification whose channel is unknown or whose
 * token does not match the stored watch token is rejected before any work, so a
 * spoofed or stale channel can never drive a sync. An inline dispatch failure is
 * swallowed: the outbox row is already durable and the reconciliation drain will
 * deliver it, so the webhook still acknowledges quickly.
 */
export function createCalendarWebhookService(
  deps: CalendarWebhookDependencies,
) {
  const { calendarRepository, syncJobRepository, dispatcher } = deps;

  return {
    async handleNotification(
      headers: RawNotificationHeaders,
    ): Promise<WebhookOutcome> {
      const notification = interpretCalendarNotification(headers);

      if (notification.kind === "handshake") {
        return { kind: "handshake" };
      }
      if (notification.kind === "ignore") {
        return { kind: "ignored", reason: notification.reason };
      }
      if (notification.kind === "invalid") {
        return { kind: "invalid", reason: notification.reason };
      }

      const calendar = await calendarRepository.getCalendarByChannel(
        notification.channelId,
      );
      if (
        !calendar ||
        !channelTokenMatches(calendar.watchToken, notification.token)
      ) {
        return { kind: "unverified" };
      }

      const { enqueued, job } = await syncJobRepository.enqueue({
        userId: calendar.userId,
        googleCalendarId: calendar.googleCalendarId,
        channelId: notification.channelId,
        messageNumber: notification.messageNumber,
      });

      // Dispatch anything not already finished. A completed job means the sync it
      // requested already ran, so a re-delivery of that message needs nothing.
      if (job.status !== "completed") {
        try {
          await dispatcher.dispatch({ jobId: job.id });
        } catch {
          // The row is durable; the reconciliation drain is the backstop.
        }
      }

      return { kind: "accepted", enqueued, jobId: job.id };
    },
  };
}

export type CalendarWebhookService = ReturnType<
  typeof createCalendarWebhookService
>;
