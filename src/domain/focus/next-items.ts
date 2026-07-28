import { Temporal } from "temporal-polyfill";

import {
  instantFromLocalParts,
  plainDateInZone,
} from "@/domain/calendar/agenda";

/**
 * The pure "what follows a Focus Session" ordering. After completion the user
 * deliberately chooses what to do next — nothing ever starts automatically — so
 * this module only orders the choices. Time-sensitive context leads: today's
 * remaining Events and today's scheduled Tasks come first, ordered by when they
 * happen, followed by available unscheduled Tasks ordered by how long they have
 * waited. It takes the current instant as an argument and has no React,
 * Next.js, Drizzle, or network dependencies.
 *
 * Callers pass already-active, undeleted records; this function does no
 * filtering by status. Anything scheduled for another day (past or future) is
 * left out entirely — it belongs to the Tasks and Calendar views, not to the
 * single calm decision offered right after focus.
 */

/** A calendar Event candidate, reduced to what the ordering needs. */
export interface NextEventInput {
  id: string;
  title: string;
  /** The exact start instant as an ISO-8601 string. */
  startAt: string;
}

/** A Task candidate, reduced to what the ordering needs. */
export interface NextTaskInput {
  id: string;
  title: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  /** ISO-8601 instant the Task was captured; older means waiting longer. */
  createdAt: string;
}

export interface NextItemsInput {
  /** The current instant as an ISO-8601 string. */
  now: string;
  /** IANA time zone used to resolve local dates and wall-clock times. */
  timeZone: string;
  events: readonly NextEventInput[];
  tasks: readonly NextTaskInput[];
}

/**
 * One ordered next item. A timed item carries `startAt` so the UI can format it;
 * a date-only Task carries `startAt: null`. `kind` lets the UI label an Event
 * apart from a Task without another lookup.
 */
export interface NextItem {
  kind: "event" | "task";
  id: string;
  title: string;
  startAt: string | null;
}

export interface NextItems {
  /** Today's remaining Events and scheduled Tasks, ordered by when they happen. */
  timeSensitive: NextItem[];
  /** Available unscheduled Tasks, ordered by how long they have waited. */
  flexible: NextItem[];
}

function epochMs(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

interface Timed {
  item: NextItem;
  /** Sort key: the start instant in epoch ms, or null for a date-only Task. */
  startAtMs: number | null;
  createdAt: string;
}

/** The shared final tie-break: older (waiting longer) first, then a stable id. */
function byWaitThenId(
  aCreatedAt: string,
  aId: string,
  bCreatedAt: string,
  bId: string,
): number {
  if (aCreatedAt !== bCreatedAt) {
    return aCreatedAt < bCreatedAt ? -1 : 1;
  }
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/** Timed items first (earliest wins), then date-only by wait, then a stable id. */
function compareTimed(a: Timed, b: Timed): number {
  if (a.startAtMs !== b.startAtMs) {
    if (a.startAtMs === null) return 1;
    if (b.startAtMs === null) return -1;
    return a.startAtMs - b.startAtMs;
  }
  // Same instant (or both date-only): an Event leads a Task, then older first.
  if (a.item.kind !== b.item.kind) {
    return a.item.kind === "event" ? -1 : 1;
  }
  return byWaitThenId(a.createdAt, a.item.id, b.createdAt, b.item.id);
}

/**
 * Orders the choices offered after a Focus Session completes. Never mutates its
 * inputs and never starts anything — it only sorts.
 */
export function orderNextItems(input: NextItemsInput): NextItems {
  const { now, timeZone, events, tasks } = input;
  const nowMs = epochMs(now);
  const today = plainDateInZone(now, timeZone);

  const timed: Timed[] = [];

  // Today's remaining Events: on today's local date and not yet started.
  for (const event of events) {
    const startAtMs = epochMs(event.startAt);
    if (
      startAtMs >= nowMs &&
      plainDateInZone(event.startAt, timeZone) === today
    ) {
      timed.push({
        item: {
          kind: "event",
          id: event.id,
          title: event.title,
          startAt: event.startAt,
        },
        startAtMs,
        createdAt: event.startAt,
      });
    }
  }

  const flexibleTasks: NextTaskInput[] = [];

  for (const task of tasks) {
    if (task.scheduledDate === null) {
      // Available unscheduled work: flexible, ordered later by waiting time.
      flexibleTasks.push(task);
      continue;
    }
    if (task.scheduledDate !== today) {
      // Scheduled for another day — not part of today's next decision.
      continue;
    }
    if (task.scheduledTime !== null) {
      const startAt = instantFromLocalParts(
        task.scheduledDate,
        task.scheduledTime,
        timeZone,
      );
      timed.push({
        item: { kind: "task", id: task.id, title: task.title, startAt },
        startAtMs: epochMs(startAt),
        createdAt: task.createdAt,
      });
    } else {
      // A date-only Task scheduled for today: time-sensitive but timeless.
      timed.push({
        item: { kind: "task", id: task.id, title: task.title, startAt: null },
        startAtMs: null,
        createdAt: task.createdAt,
      });
    }
  }

  timed.sort(compareTimed);
  flexibleTasks.sort((a, b) =>
    byWaitThenId(a.createdAt, a.id, b.createdAt, b.id),
  );

  return {
    timeSensitive: timed.map((entry) => entry.item),
    flexible: flexibleTasks.map((task) => ({
      kind: "task",
      id: task.id,
      title: task.title,
      startAt: null,
    })),
  };
}
