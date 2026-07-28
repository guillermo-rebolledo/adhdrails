import { describe, expect, it } from "vitest";

import type { RawNotificationHeaders } from "@/domain/calendar/notification";

import type { CalendarRepository, CalendarSyncRecord } from "./repository";
import { createRecordingSyncDispatcher } from "./sync-dispatcher";
import { createCalendarSyncJobRepository } from "./sync-job-repository";
import { createCalendarWebhookService } from "./webhook-service";

const CAL = "primary@example.com";

function headers(
  overrides: Partial<RawNotificationHeaders> = {},
): RawNotificationHeaders {
  return {
    channelId: "chan-1",
    token: "watch-token-1",
    resourceId: "res-1",
    resourceState: "exists",
    messageNumber: "2",
    ...overrides,
  };
}

function calendarByChannel(calendar: CalendarSyncRecord | null) {
  return {
    async getCalendarByChannel() {
      return calendar;
    },
  } as unknown as CalendarRepository;
}

function watchedCalendar(
  overrides: Partial<CalendarSyncRecord> = {},
): CalendarSyncRecord {
  return {
    userId: "user_1",
    googleCalendarId: CAL,
    summary: "Personal",
    timeZone: "America/New_York",
    isVisible: true,
    syncToken: "cursor-1",
    watchChannelId: "chan-1",
    watchResourceId: "res-1",
    watchToken: "watch-token-1",
    watchExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/**
 * An in-memory outbox so the webhook's idempotency is exercised against the same
 * enqueue contract the real repository implements, without a database.
 */
function inMemorySyncJobRepository() {
  const rows = new Map<
    string,
    { id: string; status: string; userId: string; googleCalendarId: string }
  >();
  const byDelivery = new Map<string, string>();
  let counter = 0;

  return {
    async enqueue(input: {
      userId: string;
      googleCalendarId: string;
      channelId: string;
      messageNumber: number;
    }) {
      const deliveryKey = `${input.channelId}:${input.messageNumber}`;
      const existingId = byDelivery.get(deliveryKey);
      if (existingId) {
        const job = rows.get(existingId)!;
        return { enqueued: false, job } as never;
      }
      const id = `job-${(counter += 1)}`;
      const job = {
        id,
        status: "pending",
        userId: input.userId,
        googleCalendarId: input.googleCalendarId,
        channelId: input.channelId,
        messageNumber: input.messageNumber,
        attempts: 0,
        lastErrorCode: null,
      };
      rows.set(id, job);
      byDelivery.set(deliveryKey, id);
      return { enqueued: true, job } as never;
    },
    complete(id: string) {
      rows.get(id)!.status = "completed";
    },
  };
}

function service(calendar: CalendarSyncRecord | null) {
  const jobs = inMemorySyncJobRepository();
  const dispatcher = createRecordingSyncDispatcher();
  const webhook = createCalendarWebhookService({
    calendarRepository: calendarByChannel(calendar),
    syncJobRepository: jobs as unknown as ReturnType<
      typeof createCalendarSyncJobRepository
    >,
    dispatcher,
  });
  return { webhook, jobs, dispatcher };
}

describe("handleNotification", () => {
  it("acknowledges the initial sync handshake without enqueuing", async () => {
    const { webhook, dispatcher } = service(watchedCalendar());
    const outcome = await webhook.handleNotification(
      headers({ resourceState: "sync" }),
    );
    expect(outcome).toEqual({ kind: "handshake" });
    expect(dispatcher.dispatched).toHaveLength(0);
  });

  it("verifies, enqueues, and dispatches a change notification", async () => {
    const { webhook, dispatcher } = service(watchedCalendar());
    const outcome = await webhook.handleNotification(headers());

    expect(outcome).toMatchObject({ kind: "accepted", enqueued: true });
    expect(dispatcher.dispatched).toHaveLength(1);
  });

  it("is idempotent to duplicate delivery: one job, no second dispatch of a done job", async () => {
    const { webhook, jobs, dispatcher } = service(watchedCalendar());

    const first = await webhook.handleNotification(headers());
    expect(first).toMatchObject({ kind: "accepted", enqueued: true });
    // The dispatched job finishes before the redelivery arrives.
    jobs.complete((first as { jobId: string }).jobId);

    const second = await webhook.handleNotification(headers());
    expect(second).toMatchObject({ kind: "accepted", enqueued: false });
    // Same job id both times; the completed redelivery is not dispatched again.
    expect((second as { jobId: string }).jobId).toBe(
      (first as { jobId: string }).jobId,
    );
    expect(dispatcher.dispatched).toEqual([(first as { jobId: string }).jobId]);
  });

  it("rejects an unknown channel as unverified", async () => {
    const { webhook, dispatcher } = service(null);
    expect(await webhook.handleNotification(headers())).toEqual({
      kind: "unverified",
    });
    expect(dispatcher.dispatched).toHaveLength(0);
  });

  it("rejects a token that does not match the stored watch token", async () => {
    const { webhook, dispatcher } = service(watchedCalendar());
    expect(
      await webhook.handleNotification(headers({ token: "wrong-token" })),
    ).toEqual({ kind: "unverified" });
    expect(dispatcher.dispatched).toHaveLength(0);
  });

  it("acknowledges a malformed notification without enqueuing", async () => {
    const { webhook, dispatcher } = service(watchedCalendar());
    const outcome = await webhook.handleNotification(
      headers({ messageNumber: "not-a-number" }),
    );
    expect(outcome).toEqual({ kind: "invalid", reason: "bad_message_number" });
    expect(dispatcher.dispatched).toHaveLength(0);
  });

  it("still acknowledges when the inline dispatch throws", async () => {
    const jobs = inMemorySyncJobRepository();
    const webhook = createCalendarWebhookService({
      calendarRepository: calendarByChannel(watchedCalendar()),
      syncJobRepository: jobs as unknown as ReturnType<
        typeof createCalendarSyncJobRepository
      >,
      dispatcher: {
        async dispatch() {
          throw new Error("inngest unreachable");
        },
      },
    });

    const outcome = await webhook.handleNotification(headers());
    expect(outcome).toMatchObject({ kind: "accepted", enqueued: true });
  });
});
