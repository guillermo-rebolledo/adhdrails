"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { useAnalytics } from "@/components/analytics/analytics-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { addMinutesToInstant } from "@/domain/calendar/agenda";
import { formatTime } from "@/domain/calendar/format";
import { type NextItems, orderNextItems } from "@/domain/focus/next-items";
import { FOCUS_COMPLETED_MESSAGE } from "@/domain/focus/session";
import {
  computeDeferral,
  type DeferOption,
  type FocusReason,
  orderedCandidates,
  recommendFocus,
} from "@/domain/task/recommend";
import { useCurrentEnergy } from "@/hooks/use-current-energy";
import type { LocalFocusSession } from "@/offline/db";
import {
  completeFocus,
  startFocus,
  undoFocusCompletion,
} from "@/offline/focus-commands";
import { completeTask, updateTask } from "@/offline/task-commands";
import { useOffline } from "@/offline/provider";

import { EnergyRightNow } from "./energy-right-now";
import { FocusNextItems } from "./focus-next-items";
import { FocusSession } from "./focus-session";
import { useClock } from "@/components/account/time-zone-provider";

/** How long a just-completed session can be undone before it flushes to sync. */
const COMPLETION_UNDO_WINDOW_MS = 10_000;

/** Drops a Task (by id) from both next-item groups, leaving Events untouched. */
function excludeTask(items: NextItems, taskId: string): NextItems {
  const keep = (item: { kind: string; id: string }) =>
    !(item.kind === "task" && item.id === taskId);
  return {
    timeSensitive: items.timeSensitive.filter(keep),
    flexible: items.flexible.filter(keep),
  };
}

/** The completion acknowledgement's state while the user chooses what follows. */
interface CompletionState {
  /** The pre-completion session snapshot, so Undo restores it exactly. */
  prior: LocalFocusSession;
  taskId: string;
  taskTitle: string;
}

/**
 * Picks the one session to treat as active, preferring a session confirmed or
 * still in flight over one that lost the account-wide race, so a conflict never
 * hides the real timer.
 */
function pickActiveSession(
  sessions: LocalFocusSession[] | undefined,
): LocalFocusSession | null {
  if (!sessions || sessions.length === 0) {
    return null;
  }
  return (
    sessions.find((session) => session.syncState !== "conflict") ?? sessions[0]
  );
}

/** How far ahead to look for commitments that size the estimate-fit window. */
const COMMITMENT_HORIZON_HOURS = 24;

/**
 * The Focus Now card on Today. It reads active Tasks and near-future Events
 * straight from the Dexie replica and asks the pure recommender for one Task to
 * do now, with a concise reason and an explicit Start. Nothing is hidden: every
 * other eligible Task is offered under "Choose another task", flexible work can
 * be deferred without deletion, and an empty state stays calm rather than
 * manufacturing urgency. The recommender decides; the user always overrides.
 */
export function FocusNow({
  now,
  undoWindowMs = COMPLETION_UNDO_WINDOW_MS,
  ...overrides
}: {
  timeZone?: string;
  locale?: string;
  /** The reference instant. Defaults to now; injectable to keep tests stable. */
  now?: string;
  /** The completion Undo window. Overridable only to keep tests fast. */
  undoWindowMs?: number;
}) {
  const { timeZone, locale } = useClock(overrides);
  const { db, sync, accountId } = useOffline();
  const { energy, setEnergy } = useCurrentEnergy(accountId);
  const analytics = useAnalytics();

  // A stable reference instant so the recommendation does not churn per render.
  const [reference] = useState(() => now ?? new Date().toISOString());
  const horizonEnd = useMemo(
    () => addMinutesToInstant(reference, COMMITMENT_HORIZON_HOURS * 60),
    [reference],
  );

  const tasks = useLiveQuery(
    () =>
      db.tasks
        .where("status")
        .equals("active")
        .filter((task) => task.deletedAt === null)
        .toArray(),
    [db],
  );

  const commitments = useLiveQuery(
    () =>
      db.events
        .where("startAt")
        .between(reference, horizonEnd, true, false)
        .filter((event) => event.deletedAt === null)
        .toArray(),
    [db, reference, horizonEnd],
  );

  // The account's one active (running or paused) Focus Session, if any.
  const activeSessions = useLiveQuery(
    () =>
      db.focusSessions
        .filter((session) => session.status !== "completed")
        .toArray(),
    [db],
  );
  const activeSession = pickActiveSession(activeSessions);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deferOpen, setDeferOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // A calm completion acknowledgement, shown after a session ends until the user
  // deliberately chooses what follows. No Task ever starts automatically.
  const [completion, setCompletion] = useState<CompletionState | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [showNextItems, setShowNextItems] = useState(false);
  const [taskDone, setTaskDone] = useState(false);
  // The completion is acknowledged locally but held back from sync until the
  // Undo window elapses (a delivered completion is terminal on the server).
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizedRef = useRef(true);

  // Never silently lose a held completion: flush it if the card unmounts first.
  useEffect(() => {
    return () => {
      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
      }
      if (!finalizedRef.current) {
        finalizedRef.current = true;
        void sync();
      }
    };
  }, [sync]);

  const recommendation = useMemo(
    () =>
      recommendFocus(tasks ?? [], {
        now: reference,
        timeZone,
        currentEnergy: energy,
        commitments: commitments ?? [],
      }),
    [tasks, commitments, reference, timeZone, energy],
  );

  // The deliberate "what's next" ordering, computed once so "View next items"
  // is instant. Time-sensitive context (today's events and scheduled Tasks)
  // leads available unscheduled work; nothing here ever starts automatically.
  const nextItems = useMemo(
    () =>
      orderNextItems({
        now: reference,
        timeZone,
        events: commitments ?? [],
        tasks: tasks ?? [],
      }),
    [reference, timeZone, commitments, tasks],
  );

  // Still loading the local replica — render nothing rather than a flash.
  if (tasks === undefined) {
    return null;
  }

  const ordered = orderedCandidates(recommendation);
  const manuallySelected =
    selectedId !== null && ordered.some((task) => task.id === selectedId);
  const displayed = manuallySelected
    ? (ordered.find((task) => task.id === selectedId) ?? null)
    : recommendation.task;

  const others = displayed
    ? ordered.filter((task) => task.id !== displayed.id)
    : [];

  const isFlexible = displayed !== null && displayed.scheduledTime === null;

  // Energy only shapes an actual focus decision, so it stays with one — never on
  // an empty account where it would ask for a choice with nothing to reorder.
  const showEnergy =
    displayed !== null || activeSession !== null || completion !== null;

  async function onDefer(option: DeferOption) {
    if (!displayed) {
      return;
    }
    const date = option === "custom" ? customDate : undefined;
    if (option === "custom" && !date) {
      return;
    }
    const deferral = computeDeferral(reference, timeZone, option, date);
    await updateTask(db, displayed.id, {
      scheduledDate: deferral.scheduledDate,
      scheduledTime: deferral.scheduledTime,
    });
    void sync();
    setDeferOpen(false);
    setCustomDate("");
    setSelectedId(null);
    setNotice(
      `Moved “${displayed.title}” to ${deferLabel(option, deferral.scheduledDate)}.`,
    );
  }

  async function onStart(taskId: string) {
    // Any held completion is committed before a new session begins.
    finalizeCompletion();
    setCompletion(null);
    setShowNextItems(false);
    // Starting creates the account's only active session; the server resolves a
    // competing session started elsewhere into a visible conflict on sync.
    await startFocus(db, { taskId });
    void sync();
    analytics.track({ name: "focus_session_started" });
    setSelectedId(null);
    setDeferOpen(false);
  }

  /** Flush the held completion (idempotent) and stop its Undo window. */
  function finalizeCompletion() {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    setUndoAvailable(false);
    if (!finalizedRef.current) {
      finalizedRef.current = true;
      void sync();
    }
  }

  async function onCompleteSession(session: LocalFocusSession) {
    // Snapshot the pre-completion session so Undo can restore it exactly, then
    // acknowledge completion locally without syncing yet.
    const prior = { ...session };
    const task = await db.tasks.get(session.taskId);
    await completeFocus(db, session.id);
    analytics.track({ name: "focus_session_completed" });
    finalizedRef.current = false;
    setTaskDone(false);
    setShowNextItems(false);
    setCompletion({
      prior,
      taskId: session.taskId,
      taskTitle: task?.title ?? "your task",
    });
    setUndoAvailable(true);
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
    }
    undoTimer.current = setTimeout(finalizeCompletion, undoWindowMs);
  }

  async function onUndoCompletion() {
    if (!completion) {
      return;
    }
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    // Nothing to flush: undo removes the queued completion and restores state.
    finalizedRef.current = true;
    await undoFocusCompletion(db, completion.prior);
    setCompletion(null);
    setUndoAvailable(false);
    setShowNextItems(false);
  }

  function onReturnToday() {
    finalizeCompletion();
    setCompletion(null);
    setShowNextItems(false);
  }

  function onViewNextItems() {
    finalizeCompletion();
    setShowNextItems(true);
  }

  async function onCompleteTask() {
    if (!completion) {
      return;
    }
    await completeTask(db, completion.taskId);
    void sync();
    setTaskDone(true);
  }

  return (
    <section aria-label="Focus now" className="flex flex-col gap-4">
      {showEnergy ? (
        <EnergyRightNow energy={energy} onChange={setEnergy} />
      ) : null}

      <div aria-live="polite">
        {notice ? (
          <p className="text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      {completion ? (
        // A calm acknowledgement after completing a session. Return to Today is
        // the primary next action; nothing starts on its own. A brief Undo can
        // reverse the completion, and the user may also mark the Task itself done.
        <div
          aria-label="Focus complete"
          className="rounded-xl border bg-card p-6 text-card-foreground"
        >
          <p className="font-medium" role="status">
            {FOCUS_COMPLETED_MESSAGE}
          </p>

          {taskDone ? (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              Marked “{completion.taskTitle}” done.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">
                Finished “{completion.taskTitle}”?
              </p>
              <Button
                onClick={() => void onCompleteTask()}
                size="sm"
                variant="outline"
              >
                Mark task done
              </Button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={onReturnToday}>Return to Today</Button>
            <Button onClick={onViewNextItems} variant="outline">
              View next items
            </Button>
            {undoAvailable ? (
              <Button onClick={() => void onUndoCompletion()} variant="ghost">
                Undo
              </Button>
            ) : null}
          </div>

          {showNextItems ? (
            <div className="mt-5 border-t pt-4">
              <FocusNextItems
                // Never re-offer the Task just stepped away from; if it was
                // marked done it is already gone, and if not it should not lead
                // the calm next decision.
                items={excludeTask(nextItems, completion.taskId)}
                locale={locale}
                onFocusTask={onStart}
                timeZone={timeZone}
              />
            </div>
          ) : null}
        </div>
      ) : activeSession ? (
        <FocusSession
          locale={locale}
          now={now}
          onComplete={() => onCompleteSession(activeSession)}
          session={activeSession}
          timeZone={timeZone}
        />
      ) : displayed === null ? (
        <div className="flex flex-col items-start gap-4 rounded-xl border bg-card p-6 text-card-foreground">
          <p className="text-muted-foreground">
            Nothing to focus on right now. Capture a thought above or add a task
            when you’re ready — there’s no rush.
          </p>
          <Link
            className={buttonVariants({ size: "sm", variant: "outline" })}
            href="/tasks/new"
          >
            New task
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-6 text-card-foreground">
          <p className="text-sm text-muted-foreground">Focus now</p>
          <p className="mt-1 text-lg font-medium">{displayed.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {reasonText(
              manuallySelected ? null : recommendation.reason,
              timeZone,
              locale,
            )}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => onStart(displayed.id)}>Start</Button>
            {isFlexible ? (
              <Button
                aria-expanded={deferOpen}
                onClick={() => setDeferOpen((open) => !open)}
                variant="ghost"
              >
                Not now
              </Button>
            ) : null}
          </div>

          {isFlexible && deferOpen ? (
            <div className="mt-3 flex flex-col gap-2 border-t pt-3">
              <p className="text-sm text-muted-foreground">Move it to…</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => onDefer("later-today")}
                  size="sm"
                  variant="outline"
                >
                  Later today
                </Button>
                <Button
                  onClick={() => onDefer("tomorrow")}
                  size="sm"
                  variant="outline"
                >
                  Tomorrow
                </Button>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    aria-label="Choose a date"
                    className="h-7 rounded-md border bg-background px-2 text-sm"
                    onChange={(event) => setCustomDate(event.target.value)}
                    type="date"
                    value={customDate}
                  />
                  <Button
                    disabled={customDate === ""}
                    onClick={() => onDefer("custom")}
                    size="sm"
                    variant="outline"
                  >
                    Move
                  </Button>
                </label>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {!activeSession && !completion && others.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            Choose another task
          </h3>
          <ul aria-label="Choose another task" className="flex flex-col gap-2">
            {others.map((task) => (
              <li key={task.id}>
                <Button
                  aria-label={`Focus on ${task.title}`}
                  className="w-full justify-between"
                  onClick={() => {
                    setSelectedId(task.id);
                    setDeferOpen(false);
                  }}
                  variant="outline"
                >
                  <span className="min-w-0 truncate">{task.title}</span>
                  <span className="text-muted-foreground">Focus on this</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** A concise, human explanation for why a Task was recommended. */
function reasonText(
  reason: FocusReason | null,
  timeZone: string,
  locale: string,
): string {
  if (reason === null) {
    return "You chose this.";
  }
  switch (reason.code) {
    case "scheduled-time":
      return reason.scheduledAt
        ? `Scheduled for ${formatTime(reason.scheduledAt, timeZone, locale)}.`
        : "Scheduled for now.";
    case "important":
      return "Marked important.";
    case "matches-energy":
      return `Matches your ${capitalize(reason.energy ?? "")} energy.`;
    case "fits-commitment":
      return "Fits before your next commitment.";
    case "next-up":
      return "Next up — nothing else is competing for now.";
  }
}

function deferLabel(option: DeferOption, scheduledDate: string): string {
  if (option === "later-today") {
    return "later today";
  }
  if (option === "tomorrow") {
    return "tomorrow";
  }
  return scheduledDate;
}
