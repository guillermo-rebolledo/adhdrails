import { Temporal } from "temporal-polyfill";

import {
  instantFromLocalParts,
  plainDateInZone,
} from "@/domain/calendar/agenda";

import type { TaskEnergy } from "./task";

/**
 * The pure Focus Now recommender. It answers "what should I do now?" with at
 * most one Task and a concise, structured reason, while never hiding the
 * alternatives or deciding for the user. Every rule is deterministic and takes
 * the current instant as an argument, so behavior is predictable and testable —
 * this module has no React, Next.js, Drizzle, or network dependencies.
 *
 * The rules, in the order they resolve ties:
 *
 * 1. A timed Task whose time has already come is a commitment and leads. Among
 *    such tasks the earliest time comes first.
 * 2. Otherwise, flexible work is ordered by: whether its estimate fits before
 *    the next commitment, how well it matches the current Energy, whether it is
 *    Important, and finally how long it has been waiting.
 *
 * Energy only ever reorders flexible work; it never hides a Task and never
 * touches a scheduled commitment. An estimate is informational — a Task that
 * would not fit before the next commitment is ranked lower, never removed.
 */

/** The minimal Task shape the recommender needs; a superset is fine. */
export interface RecommendableTask {
  id: string;
  title: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  estimateMinutes: number | null;
  energy: TaskEnergy | null;
  important: boolean;
  /** ISO-8601 instant the Task was captured; older means waiting longer. */
  createdAt: string;
}

/** An upcoming fixed commitment (typically a calendar Event) by start instant. */
export interface UpcomingCommitment {
  /** The exact start instant as an ISO-8601 string. */
  startAt: string;
}

export interface RecommendInput {
  /** The current instant as an ISO-8601 string. */
  now: string;
  /** IANA time zone used to resolve local dates and wall-clock times. */
  timeZone: string;
  /** The user's current Energy, or null/unset for no Energy constraint. */
  currentEnergy?: TaskEnergy | null;
  /** Fixed commitments (Events) used to size the fit window before "now". */
  commitments?: readonly UpcomingCommitment[];
}

/**
 * Why a Task was recommended, in priority order. Structured rather than a
 * prebuilt sentence so the domain stays free of locale formatting and tests can
 * assert the reason without snapshots.
 */
export type FocusReasonCode =
  | "scheduled-time"
  | "important"
  | "matches-energy"
  | "fits-commitment"
  | "next-up";

export interface FocusReason {
  code: FocusReasonCode;
  /** For `scheduled-time`: the Task's start instant, so the UI can format it. */
  scheduledAt?: string;
  /** For `matches-energy`: the Energy that matched. */
  energy?: TaskEnergy;
  /** For `fits-commitment`: whole minutes available before the next commitment. */
  availableMinutes?: number;
}

export interface FocusRecommendation {
  /** The single recommended Task, or null when nothing is appropriate now. */
  task: RecommendableTask | null;
  /** Why {@link task} was chosen, or null when there is no recommendation. */
  reason: FocusReason | null;
  /** The remaining eligible Tasks, ordered, so the user can pick another. */
  alternatives: RecommendableTask[];
}

type CandidateKind = "timed" | "flexible";

interface Candidate {
  task: RecommendableTask;
  kind: CandidateKind;
  /** For a timed candidate, its start instant in epoch milliseconds. */
  startAtMs: number | null;
  /** For a timed candidate, its start instant as an ISO string. */
  startAt: string | null;
}

function epochMs(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

/**
 * Classifies a Task for "now": whether it is eligible to be recommended, and if
 * so whether it is a timed commitment or flexible work. A Task scheduled for a
 * future day, or timed for a time that has not arrived, is not recommended now
 * (it stays visible elsewhere and, if timed, may size the fit window instead).
 */
function classify(
  task: RecommendableTask,
  nowMs: number,
  today: string,
  timeZone: string,
): { eligible: boolean; candidate: Candidate } {
  if (task.scheduledDate === null) {
    return {
      eligible: true,
      candidate: { task, kind: "flexible", startAtMs: null, startAt: null },
    };
  }

  if (task.scheduledTime !== null) {
    const startAt = instantFromLocalParts(
      task.scheduledDate,
      task.scheduledTime,
      timeZone,
    );
    const startAtMs = epochMs(startAt);
    return {
      eligible: startAtMs <= nowMs,
      candidate: { task, kind: "timed", startAtMs, startAt },
    };
  }

  // A date-only Task is flexible; it is for "now" once its day has arrived.
  return {
    eligible: task.scheduledDate <= today,
    candidate: { task, kind: "flexible", startAtMs: null, startAt: null },
  };
}

/** Whether a flexible Task's estimate fits in the window before the next commitment. */
function fitsWindow(
  task: RecommendableTask,
  availableMinutes: number,
): boolean {
  if (task.estimateMinutes === null || !Number.isFinite(availableMinutes)) {
    return true;
  }
  return task.estimateMinutes <= availableMinutes;
}

/**
 * How well a Task's Energy matches the current Energy: an exact match ranks
 * highest, an unset ("Any") Task next, and a mismatch last but still eligible.
 * With no current Energy every Task scores equally, so Energy does not reorder.
 */
function energyScore(
  task: RecommendableTask,
  current: TaskEnergy | null | undefined,
): number {
  if (!current) {
    return 0;
  }
  if (task.energy === null) {
    return 1;
  }
  return task.energy === current ? 2 : 0;
}

function compareCreatedThenId(
  a: RecommendableTask,
  b: RecommendableTask,
): number {
  // Older first (waiting longer), then a stable id tie-break.
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function makeComparator(
  availableMinutes: number,
  currentEnergy: TaskEnergy | null | undefined,
): (a: Candidate, b: Candidate) => number {
  return (a, b) => {
    // A timed commitment whose time has come always leads flexible work.
    if (a.kind !== b.kind) {
      return a.kind === "timed" ? -1 : 1;
    }

    if (a.kind === "timed" && b.kind === "timed") {
      if (a.startAtMs !== b.startAtMs) {
        return (a.startAtMs ?? 0) - (b.startAtMs ?? 0);
      }
      if (a.task.important !== b.task.important) {
        return a.task.important ? -1 : 1;
      }
      return compareCreatedThenId(a.task, b.task);
    }

    // Both flexible.
    const aFits = fitsWindow(a.task, availableMinutes);
    const bFits = fitsWindow(b.task, availableMinutes);
    if (aFits !== bFits) {
      return aFits ? -1 : 1;
    }

    const aEnergy = energyScore(a.task, currentEnergy);
    const bEnergy = energyScore(b.task, currentEnergy);
    if (aEnergy !== bEnergy) {
      return bEnergy - aEnergy;
    }

    if (a.task.important !== b.task.important) {
      return a.task.important ? -1 : 1;
    }

    return compareCreatedThenId(a.task, b.task);
  };
}

/** The minutes until the next commitment after `now`, or Infinity if none. */
function availableMinutesUntilNext(
  nowMs: number,
  commitments: readonly UpcomingCommitment[],
  timedCandidates: readonly Candidate[],
): number {
  let nextMs = Infinity;
  for (const commitment of commitments) {
    const ms = epochMs(commitment.startAt);
    if (ms > nowMs && ms < nextMs) {
      nextMs = ms;
    }
  }
  for (const candidate of timedCandidates) {
    const ms = candidate.startAtMs;
    if (ms !== null && ms > nowMs && ms < nextMs) {
      nextMs = ms;
    }
  }
  if (!Number.isFinite(nextMs)) {
    return Infinity;
  }
  return Math.max(0, Math.round((nextMs - nowMs) / 60_000));
}

function reasonFor(
  winner: Candidate,
  runnerUp: Candidate | null,
  availableMinutes: number,
  currentEnergy: TaskEnergy | null | undefined,
): FocusReason {
  if (winner.kind === "timed") {
    return {
      code: "scheduled-time",
      scheduledAt: winner.startAt ?? undefined,
    };
  }

  const { task } = winner;
  // Name the rule that actually put this Task ahead of the runner-up, following
  // the same priority the comparator uses — fit, then Energy, then Important —
  // so the explanation names the deciding factor rather than any true-but-
  // incidental attribute. A flexible winner never has a timed runner-up.
  if (runnerUp !== null && runnerUp.kind === "flexible") {
    const winnerFits = fitsWindow(task, availableMinutes);
    const runnerFits = fitsWindow(runnerUp.task, availableMinutes);
    if (winnerFits !== runnerFits && winnerFits) {
      return { code: "fits-commitment", availableMinutes };
    }
    if (
      energyScore(task, currentEnergy) !==
        energyScore(runnerUp.task, currentEnergy) &&
      currentEnergy &&
      task.energy === currentEnergy
    ) {
      return { code: "matches-energy", energy: currentEnergy };
    }
    if (task.important !== runnerUp.task.important && task.important) {
      return { code: "important" };
    }
  }

  // No runner-up, or the pair tied on every rule and waiting time decided: fall
  // back to the winner's most salient standing attribute.
  if (task.important) {
    return { code: "important" };
  }
  if (currentEnergy && task.energy === currentEnergy) {
    return { code: "matches-energy", energy: currentEnergy };
  }
  if (Number.isFinite(availableMinutes) && fitsWindow(task, availableMinutes)) {
    return { code: "fits-commitment", availableMinutes };
  }
  return { code: "next-up" };
}

/**
 * Recommends a single Focus Now Task from the given active Tasks, or nothing
 * when none is appropriate right now. The result also carries the ordered
 * alternatives so a user can choose a different Task without any carousel.
 */
export function recommendFocus(
  tasks: readonly RecommendableTask[],
  input: RecommendInput,
): FocusRecommendation {
  const { now, timeZone, currentEnergy = null, commitments = [] } = input;
  const nowMs = epochMs(now);
  const today = plainDateInZone(now, timeZone);

  const eligible: Candidate[] = [];
  const timedCandidates: Candidate[] = [];
  for (const task of tasks) {
    const { eligible: isEligible, candidate } = classify(
      task,
      nowMs,
      today,
      timeZone,
    );
    if (candidate.kind === "timed") {
      timedCandidates.push(candidate);
    }
    if (isEligible) {
      eligible.push(candidate);
    }
  }

  if (eligible.length === 0) {
    return { task: null, reason: null, alternatives: [] };
  }

  const availableMinutes = availableMinutesUntilNext(
    nowMs,
    commitments,
    timedCandidates,
  );

  const ordered = eligible
    .slice()
    .sort(makeComparator(availableMinutes, currentEnergy));

  const [top, ...rest] = ordered;
  return {
    task: top.task,
    reason: reasonFor(top, rest[0] ?? null, availableMinutes, currentEnergy),
    alternatives: rest.map((candidate) => candidate.task),
  };
}

/** The full ordered candidate list: the recommended Task first, then the rest. */
export function orderedCandidates(
  recommendation: FocusRecommendation,
): RecommendableTask[] {
  return recommendation.task === null
    ? []
    : [recommendation.task, ...recommendation.alternatives];
}

/** How a user may defer flexible work out of "now" without deleting it. */
export type DeferOption = "later-today" | "tomorrow" | "custom";

/** How many hours "Later today" pushes a Task forward. */
export const LATER_TODAY_OFFSET_HOURS = 3;

/** The schedule a deferral produces, ready to apply as a Task patch. */
export interface Deferral {
  scheduledDate: string;
  scheduledTime: string | null;
}

/**
 * Computes the new schedule for deferring a flexible Task. "Tomorrow" and a
 * chosen date become date-only schedules (no implied time or reminder); "Later
 * today" becomes a timed schedule a few hours out so the Task steps out of the
 * current recommendation and returns when its time comes. "Later today" always
 * stays on today — clamped to the end of the day near midnight — so the label
 * and the resulting schedule never disagree.
 */
export function computeDeferral(
  now: string,
  timeZone: string,
  option: DeferOption,
  chosenDate?: string,
): Deferral {
  if (option === "tomorrow") {
    const today = plainDateInZone(now, timeZone);
    const tomorrow = Temporal.PlainDate.from(today).add({ days: 1 }).toString();
    return { scheduledDate: tomorrow, scheduledTime: null };
  }

  if (option === "custom") {
    if (!chosenDate) {
      throw new Error("A chosen date is required to defer to a specific day.");
    }
    return { scheduledDate: chosenDate, scheduledTime: null };
  }

  const zonedNow = Temporal.Instant.from(now).toZonedDateTimeISO(timeZone);
  const later = zonedNow.add({ hours: LATER_TODAY_OFFSET_HOURS });
  const endOfToday = zonedNow.withPlainTime("23:59");
  const target =
    Temporal.ZonedDateTime.compare(later, endOfToday) > 0 ? endOfToday : later;
  return {
    scheduledDate: target.toPlainDate().toString(),
    scheduledTime: target.toPlainTime().toString().slice(0, 5),
  };
}
