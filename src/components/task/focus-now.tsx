"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { Button } from "@/components/ui/button";
import { addMinutesToInstant } from "@/domain/calendar/agenda";
import { formatTime } from "@/domain/calendar/format";
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
import { completeFocus, startFocus } from "@/offline/focus-commands";
import { updateTask } from "@/offline/task-commands";
import { useOffline } from "@/offline/provider";

import { EnergyRightNow } from "./energy-right-now";
import { FocusSession } from "./focus-session";

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
  timeZone,
  locale,
  now,
}: {
  timeZone: string;
  locale: string;
  /** The reference instant. Defaults to now; injectable to keep tests stable. */
  now?: string;
}) {
  const { db, sync, accountId } = useOffline();
  const { energy, setEnergy } = useCurrentEnergy(accountId);

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
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);

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

  // Still loading the local replica — render nothing rather than a flash.
  if (tasks === undefined) {
    return (
      <section aria-label="Focus now" className="flex flex-col gap-4">
        <EnergyRightNow energy={energy} onChange={setEnergy} />
      </section>
    );
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
    // Starting creates the account's only active session; the server resolves a
    // competing session started elsewhere into a visible conflict on sync.
    await startFocus(db, { taskId });
    void sync();
    setSelectedId(null);
    setDeferOpen(false);
  }

  async function onCompleteSession(sessionId: string) {
    await completeFocus(db, sessionId);
    void sync();
    setCompletionNotice(FOCUS_COMPLETED_MESSAGE);
  }

  return (
    <section aria-label="Focus now" className="flex flex-col gap-4">
      <EnergyRightNow energy={energy} onChange={setEnergy} />

      <div aria-live="polite">
        {notice ? (
          <p className="text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      {completionNotice ? (
        // A calm acknowledgement after completing a session. Return to Today is
        // the primary next action; nothing starts on its own.
        <div
          aria-label="Focus complete"
          className="rounded-xl border bg-card p-6 text-card-foreground"
        >
          <p className="font-medium" role="status">
            {completionNotice}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setCompletionNotice(null)}>
              Return to Today
            </Button>
          </div>
        </div>
      ) : activeSession ? (
        <FocusSession
          now={now}
          onComplete={() => onCompleteSession(activeSession.id)}
          session={activeSession}
        />
      ) : displayed === null ? (
        <div className="rounded-xl border bg-card p-6 text-card-foreground">
          <p className="text-muted-foreground">
            Nothing to focus on right now. Capture a thought or add a task when
            you’re ready — there’s no rush.
          </p>
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

      {!activeSession && !completionNotice && others.length > 0 ? (
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
