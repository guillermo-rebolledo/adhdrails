"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import {
  isEventCueDue,
  isTaskCueDue,
  type ReminderPreferences,
} from "@/domain/notification/reminder";
import { useOffline } from "@/offline/provider";
import { useClock } from "@/components/account/time-zone-provider";

interface CueTask {
  id: string;
  title: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
}

interface CueEvent {
  id: string;
  title: string;
  startAt: string;
  isAllDay: boolean;
}

export function InAppReminderList({
  tasks,
  events,
  preferences,
  nowIso,
  timeZone,
  locale,
}: {
  tasks: CueTask[];
  events: CueEvent[];
  preferences: ReminderPreferences;
  nowIso: string;
  timeZone: string;
  locale: string;
}) {
  const taskCues = tasks.filter((task) =>
    isTaskCueDue(task, timeZone, preferences, nowIso),
  );
  const eventCues = preferences.eventCueEnabled
    ? events.filter(
        (event) => !event.isAllDay && isEventCueDue(event.startAt, nowIso),
      )
    : [];
  if (taskCues.length === 0 && eventCues.length === 0) return null;

  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    timeStyle: "short",
  });

  return (
    <section
      aria-labelledby="in-app-reminder-title"
      className="rounded-xl border bg-muted/40 p-4"
      role="status"
    >
      <h2 id="in-app-reminder-title" className="text-sm font-medium">
        In-app cue
      </h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {taskCues.map((task) => (
          <li key={task.id}>
            Timed Task: <span className="font-medium">{task.title}</span>
          </li>
        ))}
        {eventCues.map((event) => (
          <li key={event.id}>
            Event soon: <span className="font-medium">{event.title}</span>{" "}
            <span className="text-muted-foreground">
              at {time.format(new Date(event.startAt))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Offline-first cue surface for Today. It observes the same Dexie Task/Event
 * replica as the agenda, so denied permission or no network never removes
 * awareness of already-synchronized commitments.
 */
export function InAppReminderCues({
  preferences,
  ...overrides
}: {
  preferences: ReminderPreferences;
  timeZone?: string;
  locale?: string;
}) {
  const { timeZone, locale } = useClock(overrides);
  const { db } = useOffline();
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = window.setInterval(
      () => setNowIso(new Date().toISOString()),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const tasks = useLiveQuery(
    () =>
      db.tasks
        .filter(
          (task) =>
            task.status === "active" &&
            task.deletedAt === null &&
            task.scheduledDate !== null &&
            task.scheduledTime !== null,
        )
        .toArray(),
    [db],
  );
  const eventWindowEnd = new Date(
    new Date(nowIso).getTime() + 15 * 60_000,
  ).toISOString();
  const events = useLiveQuery(
    () =>
      db.events
        .where("startAt")
        .between(nowIso, eventWindowEnd, true, true)
        .filter(
          (event) =>
            event.status !== "cancelled" &&
            event.deletedAt === null &&
            !event.isAllDay,
        )
        .toArray(),
    [db, nowIso, eventWindowEnd],
  );

  if (!tasks || !events) return null;
  return (
    <InAppReminderList
      events={events}
      locale={locale}
      nowIso={nowIso}
      preferences={preferences}
      tasks={tasks}
      timeZone={timeZone}
    />
  );
}
