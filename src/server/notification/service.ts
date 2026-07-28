import {
  safeTestPushPayload,
  type ReminderPreferences,
} from "@/domain/notification/reminder";

import type {
  PushSubscriptionInput,
  createNotificationRepository,
} from "./repository";
import type { PushAdapter } from "./reminder-service";

type Repository = ReturnType<typeof createNotificationRepository>;

export function createNotificationService(
  repository: Repository,
  getPushAdapter: () => PushAdapter,
) {
  return {
    getPreferences(userId: string) {
      return repository.getPreferences(userId);
    },

    savePreferences(userId: string, preferences: ReminderPreferences) {
      return repository.savePreferences(userId, preferences);
    },

    saveSubscription(userId: string, subscription: PushSubscriptionInput) {
      return repository.saveSubscription(userId, subscription);
    },

    async removeSubscription(userId: string, id: string): Promise<void> {
      await repository.deleteSubscription(userId, id);
    },

    async sendTest(
      userId: string,
      subscriptionId: string,
    ): Promise<"sent" | "expired" | "not_found" | "unavailable"> {
      const subscription = await repository.getSubscription(
        userId,
        subscriptionId,
      );
      if (!subscription) return "not_found";
      try {
        const outcome = await getPushAdapter().send(
          subscription,
          JSON.stringify(safeTestPushPayload()),
        );
        if (outcome === "expired") {
          await repository.deleteSubscription(userId, subscription.id);
        }
        return outcome;
      } catch {
        return "unavailable";
      }
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
