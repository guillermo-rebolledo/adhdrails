import { Temporal } from "temporal-polyfill";
import { z } from "zod";

export const REMINDER_LEAD_MINUTES = [5, 10, 15, 30] as const;
export type ReminderLeadMinutes = (typeof REMINDER_LEAD_MINUTES)[number];

export const reminderPreferencesSchema = z.object({
  enabled: z.boolean(),
  headsUpEnabled: z.boolean(),
  leadMinutes: z.union([
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(30),
  ]),
  atTimeEnabled: z.boolean(),
  eventCueEnabled: z.boolean(),
});

export type ReminderPreferences = z.infer<typeof reminderPreferencesSchema>;

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  enabled: false,
  headsUpEnabled: true,
  leadMinutes: 10,
  atTimeEnabled: false,
  eventCueEnabled: true,
};

export const reminderPreferencesPatchSchema =
  reminderPreferencesSchema.partial();

export const pushSubscriptionSchema = z.object({
  id: z.uuid(),
  endpoint: z
    .url()
    .max(4096)
    .refine((value) => new URL(value).protocol === "https:", {
      message: "A secure push endpoint is required.",
    }),
  expirationTime: z.number().nonnegative().nullable(),
  keys: z.object({
    p256dh: z.string().min(1).max(4096),
    auth: z.string().min(1).max(4096),
  }),
});

export const pushSubscriptionDeleteSchema = z.object({ id: z.uuid() });
export const testNotificationSchema = z.object({ subscriptionId: z.uuid() });

export type ReminderKind = "heads_up" | "at_time";

export interface ReminderTaskSchedule {
  id: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
}

export interface DueTaskReminder {
  taskId: string;
  kind: ReminderKind;
  scheduledFor: string;
}

const SCHEDULER_LOOKBACK_SECONDS = 5 * 60;
const AT_TIME_CUE_SECONDS = 60;

function taskScheduleInstant(
  task: ReminderTaskSchedule,
  timeZone: string,
): Temporal.Instant | null {
  if (task.scheduledDate === null || task.scheduledTime === null) return null;
  try {
    const date = Temporal.PlainDate.from(task.scheduledDate);
    const time = Temporal.PlainTime.from(task.scheduledTime);
    return Temporal.ZonedDateTime.from(
      {
        timeZone,
        year: date.year,
        month: date.month,
        day: date.day,
        hour: time.hour,
        minute: time.minute,
      },
      { disambiguation: "compatible" },
    ).toInstant();
  } catch {
    return null;
  }
}

/**
 * Resolves one Task's wall-clock schedule in the account timezone and returns
 * the reminders due in the current one-minute scheduler window. Temporal's
 * compatible disambiguation preserves wall-clock intent through DST changes.
 */
export function dueTaskReminders(
  task: ReminderTaskSchedule,
  timeZone: string,
  preferences: ReminderPreferences,
  nowIso: string,
): DueTaskReminder[] {
  if (
    !preferences.enabled ||
    task.scheduledDate === null ||
    task.scheduledTime === null
  ) {
    return [];
  }

  const taskInstant = taskScheduleInstant(task, timeZone);
  if (!taskInstant) return [];

  const now = Temporal.Instant.from(nowIso);
  const candidates: { kind: ReminderKind; instant: Temporal.Instant }[] = [];

  if (preferences.headsUpEnabled) {
    candidates.push({
      kind: "heads_up",
      instant: taskInstant.subtract({
        minutes: preferences.leadMinutes,
      }),
    });
  }
  if (preferences.atTimeEnabled) {
    candidates.push({ kind: "at_time", instant: taskInstant });
  }

  return candidates
    .filter(
      ({ instant }) =>
        Temporal.Instant.compare(now, instant) >= 0 &&
        Temporal.Instant.compare(
          now,
          instant.add({ seconds: SCHEDULER_LOOKBACK_SECONDS }),
        ) < 0,
    )
    .map(({ kind, instant }) => ({
      taskId: task.id,
      kind,
      scheduledFor: instant.toString(),
    }));
}

/**
 * In-app Task cues remain available without Notification permission. The
 * account's heads-up and at-time choices still control when the cue appears,
 * while the browser-notification master switch is deliberately ignored.
 */
export function isTaskCueDue(
  task: ReminderTaskSchedule,
  timeZone: string,
  preferences: ReminderPreferences,
  nowIso: string,
): boolean {
  const taskInstant = taskScheduleInstant(task, timeZone);
  if (!taskInstant) return false;
  const now = Temporal.Instant.from(nowIso);
  const headsUp =
    preferences.headsUpEnabled &&
    Temporal.Instant.compare(
      now,
      taskInstant.subtract({ minutes: preferences.leadMinutes }),
    ) >= 0 &&
    Temporal.Instant.compare(now, taskInstant) < 0;
  const atTime =
    preferences.atTimeEnabled &&
    Temporal.Instant.compare(now, taskInstant) >= 0 &&
    Temporal.Instant.compare(
      now,
      taskInstant.add({ seconds: AT_TIME_CUE_SECONDS }),
    ) < 0;
  return headsUp || atTime;
}

/** Event cues are in-app only and occupy the 15 minutes before an Event. */
export function isEventCueDue(startAt: string, nowIso: string): boolean {
  const start = Temporal.Instant.from(startAt);
  const now = Temporal.Instant.from(nowIso);
  return (
    Temporal.Instant.compare(now, start.subtract({ minutes: 15 })) >= 0 &&
    Temporal.Instant.compare(now, start) < 0
  );
}

/**
 * The push message deliberately contains no user-authored content, timestamps,
 * account ids, Task ids, or Event details.
 */
export function safePushPayload(kind: ReminderKind) {
  return {
    kind: "timed-task" as const,
    moment: kind,
    href: "/today" as const,
  };
}

export function safeTestPushPayload() {
  return { kind: "test" as const, href: "/settings" as const };
}
