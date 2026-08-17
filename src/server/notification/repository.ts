import { and, between, eq, isNotNull, lt, lte, or, sql } from "drizzle-orm";

import {
  DEFAULT_REMINDER_PREFERENCES,
  reminderPreferencesSchema,
  type ReminderPreferences,
} from "@/domain/notification/reminder";
import { resolveEffectiveTimeZone } from "@/domain/account/onboarding";
import type { Database } from "@/server/db/connection";
import {
  pushSubscription,
  reminderPreference,
  task,
  taskReminderDelivery,
  user,
} from "@/server/db/schema";

import type {
  ReminderCandidate,
  ReminderDeliveryRepository,
  ReminderRetryCandidate,
  StoredPushSubscription,
} from "./reminder-service";

export interface PushSubscriptionInput extends StoredPushSubscription {
  expirationTime: Date | null;
}

const candidateColumns = {
  userId: task.userId,
  timezone: user.timezone,
  taskId: task.id,
  scheduledDate: task.scheduledDate,
  scheduledTime: task.scheduledTime,
  enabled: reminderPreference.enabled,
  headsUpEnabled: reminderPreference.headsUpEnabled,
  leadMinutes: reminderPreference.leadMinutes,
  atTimeEnabled: reminderPreference.atTimeEnabled,
  eventCueEnabled: reminderPreference.eventCueEnabled,
  subscriptionId: pushSubscription.id,
  endpoint: pushSubscription.endpoint,
  p256dh: pushSubscription.p256dh,
  auth: pushSubscription.auth,
};

function preferencesFrom(row: {
  enabled: boolean;
  headsUpEnabled: boolean;
  leadMinutes: number;
  atTimeEnabled: boolean;
  eventCueEnabled: boolean;
}): ReminderPreferences {
  return reminderPreferencesSchema.parse(row);
}

function candidateFrom(row: {
  userId: string;
  /** `null` when the account's zone is still unknown. */
  timezone: string | null;
  taskId: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  enabled: boolean;
  headsUpEnabled: boolean;
  leadMinutes: number;
  atTimeEnabled: boolean;
  eventCueEnabled: boolean;
  subscriptionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): ReminderCandidate | null {
  if (row.scheduledDate === null) return null;
  return {
    userId: row.userId,
    // No browser exists here, so an account whose zone was never captured falls
    // back to the default. The client records the browser's zone on first load
    // precisely so this branch stops being reached.
    timezone: resolveEffectiveTimeZone(row.timezone),
    taskId: row.taskId,
    scheduledDate: row.scheduledDate,
    scheduledTime: row.scheduledTime,
    preferences: preferencesFrom(row),
    subscription: {
      id: row.subscriptionId,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

/**
 * Account-scoped notification persistence plus the durable, per-device delivery
 * claim used by the Inngest reminder sweep.
 */
export function createNotificationRepository(database: Database) {
  return {
    async getPreferences(userId: string): Promise<ReminderPreferences> {
      const [row] = await database
        .select({
          enabled: reminderPreference.enabled,
          headsUpEnabled: reminderPreference.headsUpEnabled,
          leadMinutes: reminderPreference.leadMinutes,
          atTimeEnabled: reminderPreference.atTimeEnabled,
          eventCueEnabled: reminderPreference.eventCueEnabled,
        })
        .from(reminderPreference)
        .where(eq(reminderPreference.userId, userId))
        .limit(1);

      return row ? preferencesFrom(row) : DEFAULT_REMINDER_PREFERENCES;
    },

    async savePreferences(
      userId: string,
      preferences: ReminderPreferences,
    ): Promise<ReminderPreferences> {
      const [row] = await database
        .insert(reminderPreference)
        .values({ userId, ...preferences })
        .onConflictDoUpdate({
          target: reminderPreference.userId,
          set: { ...preferences, updatedAt: new Date() },
        })
        .returning({
          enabled: reminderPreference.enabled,
          headsUpEnabled: reminderPreference.headsUpEnabled,
          leadMinutes: reminderPreference.leadMinutes,
          atTimeEnabled: reminderPreference.atTimeEnabled,
          eventCueEnabled: reminderPreference.eventCueEnabled,
        });
      return preferencesFrom(row);
    },

    async getSubscription(
      userId: string,
      id: string,
    ): Promise<StoredPushSubscription | null> {
      const [row] = await database
        .select({
          id: pushSubscription.id,
          endpoint: pushSubscription.endpoint,
          p256dh: pushSubscription.p256dh,
          auth: pushSubscription.auth,
        })
        .from(pushSubscription)
        .where(
          and(eq(pushSubscription.userId, userId), eq(pushSubscription.id, id)),
        )
        .limit(1);
      return row ?? null;
    },

    async saveSubscription(
      userId: string,
      subscription: PushSubscriptionInput,
    ): Promise<string> {
      const [existing] = await database
        .select({ id: pushSubscription.id })
        .from(pushSubscription)
        .where(
          and(
            eq(pushSubscription.userId, userId),
            eq(pushSubscription.id, subscription.id),
          ),
        )
        .limit(1);
      if (existing) {
        await database
          .update(pushSubscription)
          .set({
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime,
            p256dh: subscription.p256dh,
            auth: subscription.auth,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pushSubscription.userId, userId),
              eq(pushSubscription.id, subscription.id),
            ),
          );
        return existing.id;
      }

      return database.transaction(async (transaction) => {
        const [sameEndpoint] = await transaction
          .select({
            id: pushSubscription.id,
            userId: pushSubscription.userId,
          })
          .from(pushSubscription)
          .where(eq(pushSubscription.endpoint, subscription.endpoint))
          .limit(1);

        // A browser profile may change Rails accounts. Removing the prior
        // subscription also cascades its old-account delivery history before
        // the same provider endpoint is assigned to the current account.
        if (sameEndpoint && sameEndpoint.userId !== userId) {
          await transaction
            .delete(pushSubscription)
            .where(eq(pushSubscription.id, sameEndpoint.id));
        }

        const [saved] = await transaction
          .insert(pushSubscription)
          .values({ userId, ...subscription })
          .onConflictDoUpdate({
            target: pushSubscription.endpoint,
            set: {
              expirationTime: subscription.expirationTime,
              p256dh: subscription.p256dh,
              auth: subscription.auth,
              updatedAt: new Date(),
            },
          })
          .returning({ id: pushSubscription.id });
        return saved.id;
      });
    },

    async deleteSubscription(userId: string, id: string): Promise<void> {
      await database
        .delete(pushSubscription)
        .where(
          and(eq(pushSubscription.userId, userId), eq(pushSubscription.id, id)),
        );
    },

    async listCandidates(now: Date): Promise<ReminderCandidate[]> {
      const lower = new Date(now.getTime() - 36 * 60 * 60_000)
        .toISOString()
        .slice(0, 10);
      const upper = new Date(now.getTime() + 36 * 60 * 60_000)
        .toISOString()
        .slice(0, 10);
      const rows = await database
        .select(candidateColumns)
        .from(task)
        .innerJoin(user, eq(user.id, task.userId))
        .innerJoin(
          reminderPreference,
          eq(reminderPreference.userId, task.userId),
        )
        .innerJoin(pushSubscription, eq(pushSubscription.userId, task.userId))
        .where(
          and(
            eq(task.status, "active"),
            eq(reminderPreference.enabled, true),
            isNotNull(task.scheduledDate),
            isNotNull(task.scheduledTime),
            between(task.scheduledDate, lower, upper),
          ),
        );

      return rows.flatMap((row) => {
        const candidate = candidateFrom(row);
        return candidate ? [candidate] : [];
      });
    },

    async listRetries(now: Date): Promise<ReminderRetryCandidate[]> {
      const rows = await database
        .select({
          ...candidateColumns,
          kind: taskReminderDelivery.kind,
          scheduledFor: taskReminderDelivery.scheduledFor,
        })
        .from(taskReminderDelivery)
        .innerJoin(task, eq(task.id, taskReminderDelivery.taskId))
        .innerJoin(user, eq(user.id, taskReminderDelivery.userId))
        .innerJoin(
          reminderPreference,
          eq(reminderPreference.userId, taskReminderDelivery.userId),
        )
        .innerJoin(
          pushSubscription,
          eq(pushSubscription.id, taskReminderDelivery.subscriptionId),
        )
        .where(
          and(
            eq(taskReminderDelivery.status, "failed"),
            lte(taskReminderDelivery.nextAttemptAt, now),
            lt(taskReminderDelivery.attempts, 4),
            eq(task.status, "active"),
            eq(reminderPreference.enabled, true),
          ),
        );

      return rows.flatMap((row) => {
        const candidate = candidateFrom(row);
        if (!candidate || (row.kind !== "heads_up" && row.kind !== "at_time")) {
          return [];
        }
        return [
          {
            ...candidate,
            reminder: {
              kind: row.kind,
              scheduledFor: row.scheduledFor,
            },
          },
        ];
      });
    },

    async claimDelivery(input: {
      userId: string;
      subscriptionId: string;
      taskId: string;
      kind: "heads_up" | "at_time";
      scheduledFor: Date;
      now: Date;
    }) {
      const id = crypto.randomUUID();
      const [created] = await database
        .insert(taskReminderDelivery)
        .values({
          id,
          userId: input.userId,
          subscriptionId: input.subscriptionId,
          taskId: input.taskId,
          kind: input.kind,
          scheduledFor: input.scheduledFor,
          updatedAt: input.now,
        })
        .onConflictDoNothing()
        .returning({
          id: taskReminderDelivery.id,
          attempt: taskReminderDelivery.attempts,
        });
      if (created) return created;

      const staleLease = new Date(input.now.getTime() - 10 * 60_000);
      const [retried] = await database
        .update(taskReminderDelivery)
        .set({
          status: "processing",
          attempts: sql`${taskReminderDelivery.attempts} + 1`,
          nextAttemptAt: null,
          lastErrorCode: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(taskReminderDelivery.userId, input.userId),
            eq(taskReminderDelivery.subscriptionId, input.subscriptionId),
            eq(taskReminderDelivery.taskId, input.taskId),
            eq(taskReminderDelivery.kind, input.kind),
            eq(taskReminderDelivery.scheduledFor, input.scheduledFor),
            lt(taskReminderDelivery.attempts, 4),
            or(
              and(
                eq(taskReminderDelivery.status, "failed"),
                lte(taskReminderDelivery.nextAttemptAt, input.now),
              ),
              and(
                eq(taskReminderDelivery.status, "processing"),
                lte(taskReminderDelivery.updatedAt, staleLease),
              ),
            ),
          ),
        )
        .returning({
          id: taskReminderDelivery.id,
          attempt: taskReminderDelivery.attempts,
        });
      return retried ?? null;
    },

    async completeDelivery(userId: string, id: string): Promise<void> {
      await database
        .update(taskReminderDelivery)
        .set({
          status: "completed",
          nextAttemptAt: null,
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(taskReminderDelivery.userId, userId),
            eq(taskReminderDelivery.id, id),
          ),
        );
    },

    async failDelivery(
      userId: string,
      id: string,
      nextAttemptAt: Date,
      safeCode: string,
    ): Promise<void> {
      await database
        .update(taskReminderDelivery)
        .set({
          status: "failed",
          nextAttemptAt,
          lastErrorCode: safeCode,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(taskReminderDelivery.userId, userId),
            eq(taskReminderDelivery.id, id),
          ),
        );
    },
  } satisfies ReminderDeliveryRepository & {
    getPreferences(userId: string): Promise<ReminderPreferences>;
    savePreferences(
      userId: string,
      preferences: ReminderPreferences,
    ): Promise<ReminderPreferences>;
    getSubscription(
      userId: string,
      id: string,
    ): Promise<StoredPushSubscription | null>;
    saveSubscription(
      userId: string,
      subscription: PushSubscriptionInput,
    ): Promise<string>;
  };
}
