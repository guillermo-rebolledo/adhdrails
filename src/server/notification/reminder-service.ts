import {
  dueTaskReminders,
  safePushPayload,
  type ReminderKind,
  type ReminderPreferences,
} from "@/domain/notification/reminder";

export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface ReminderCandidate {
  userId: string;
  timezone: string;
  taskId: string;
  scheduledDate: string;
  scheduledTime: string | null;
  preferences: ReminderPreferences;
  subscription: StoredPushSubscription;
}

export interface ReminderRetryCandidate extends ReminderCandidate {
  reminder: {
    kind: ReminderKind;
    scheduledFor: Date;
  };
}

interface DeliveryClaim {
  id: string;
  attempt: number;
}

export interface ReminderDeliveryRepository {
  listCandidates(now: Date): Promise<ReminderCandidate[]>;
  listRetries(now: Date): Promise<ReminderRetryCandidate[]>;
  claimDelivery(input: {
    userId: string;
    subscriptionId: string;
    taskId: string;
    kind: ReminderKind;
    scheduledFor: Date;
    now: Date;
  }): Promise<DeliveryClaim | null>;
  completeDelivery(userId: string, id: string): Promise<void>;
  failDelivery(
    userId: string,
    id: string,
    nextAttemptAt: Date,
    safeCode: string,
  ): Promise<void>;
  deleteSubscription(userId: string, subscriptionId: string): Promise<void>;
}

export interface PushAdapter {
  send(
    subscription: StoredPushSubscription,
    payload: string,
  ): Promise<"sent" | "expired">;
}

export interface ReminderDeliveryResult {
  delivered: number;
  expired: number;
  failed: number;
}

export function createReminderDeliveryService(
  repository: ReminderDeliveryRepository,
  push: PushAdapter,
) {
  return {
    async run(now: Date): Promise<ReminderDeliveryResult> {
      const result: ReminderDeliveryResult = {
        delivered: 0,
        expired: 0,
        failed: 0,
      };
      const candidates = await repository.listCandidates(now);
      const retries = await repository.listRetries(now);

      for (const candidate of candidates) {
        const reminders = dueTaskReminders(
          {
            id: candidate.taskId,
            scheduledDate: candidate.scheduledDate,
            scheduledTime: candidate.scheduledTime,
          },
          candidate.timezone,
          candidate.preferences,
          now.toISOString(),
        );

        for (const reminder of reminders) {
          await deliver(candidate, {
            kind: reminder.kind,
            scheduledFor: new Date(reminder.scheduledFor),
          });
        }
      }

      for (const candidate of retries) {
        await deliver(candidate, candidate.reminder);
      }

      return result;

      async function deliver(
        candidate: ReminderCandidate,
        reminder: { kind: ReminderKind; scheduledFor: Date },
      ) {
        const claim = await repository.claimDelivery({
          userId: candidate.userId,
          subscriptionId: candidate.subscription.id,
          taskId: candidate.taskId,
          kind: reminder.kind,
          scheduledFor: reminder.scheduledFor,
          now,
        });
        if (!claim) return;

        try {
          const outcome = await push.send(
            candidate.subscription,
            JSON.stringify(safePushPayload(reminder.kind)),
          );
          if (outcome === "expired") {
            await repository.deleteSubscription(
              candidate.userId,
              candidate.subscription.id,
            );
            result.expired += 1;
          } else {
            result.delivered += 1;
          }
          await repository.completeDelivery(candidate.userId, claim.id);
        } catch {
          const retryMinutes = Math.min(2 ** claim.attempt, 30);
          await repository.failDelivery(
            candidate.userId,
            claim.id,
            new Date(now.getTime() + retryMinutes * 60_000),
            "push_unavailable",
          );
          result.failed += 1;
        }
      }
    },
  };
}

export type ReminderDeliveryService = ReturnType<
  typeof createReminderDeliveryService
>;
