"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useLiveQuery } from "dexie-react-hooks";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/domain/account/onboarding";
import { durationMinutesBetween } from "@/domain/calendar/agenda";
import { formatTime } from "@/domain/calendar/format";
import {
  elapsedSeconds,
  FOCUS_ESTIMATE_REACHED_MESSAGE,
  hasReachedEstimate,
} from "@/domain/focus/session";
import type { LocalFocusSession } from "@/offline/db";
import {
  captureDistraction,
  focusStateOf,
  pauseFocus,
  resumeFocus,
} from "@/offline/focus-commands";
import { useOffline } from "@/offline/provider";
import { cn } from "@/lib/utils";

/**
 * A gentle count-up as `m:ss`, or `h:mm:ss` past an hour. Never a countdown — an
 * estimate must not turn into pressure.
 */
export function formatElapsed(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

/** How long the "Saved to Inbox" distraction confirmation lingers. */
const DISTRACTION_NOTICE_MS = 4_000;
/** Only surface a commitment cue this far ahead, so it stays time-sensitive. */
const CUE_HORIZON_MINUTES = 12 * 60;

/**
 * The active Focus Session on Today: a low-distraction card with a count-up
 * timer, the session controls, distraction capture, and compact time-sensitive
 * cues. Pause preserves the elapsed time and is explicitly not "Move to later"
 * (a planning action offered before a session starts); Complete ends the session
 * and never auto-starts another Task. Controls are acknowledged optimistically
 * through the local command layer, so the timer reacts within the performance
 * budget and survives navigation and reopening.
 *
 * "Enter focus view" opens a full-screen overlay that lets unrelated interface
 * recede while keeping the same session and controls — Base UI owns the focus
 * trap, Escape, and focus restoration; the expand is a restrained scale/fade
 * that reduced-motion removes entirely.
 */
export function FocusSession({
  session,
  onComplete,
  now,
  timeZone = DEFAULT_TIMEZONE,
  locale = DEFAULT_LOCALE,
}: {
  session: LocalFocusSession;
  /** Ending the session; the parent shows the calm acknowledgement afterward. */
  onComplete: () => void | Promise<void>;
  /** Reference instant. Defaults to a live clock; injectable to keep tests stable. */
  now?: string;
  timeZone?: string;
  locale?: string;
}) {
  const { db, sync } = useOffline();
  const task = useLiveQuery(
    () => db.tasks.get(session.taskId),
    [db, session.taskId],
  );

  const [reference, setReference] = useState(
    () => now ?? new Date().toISOString(),
  );
  const isRunning = session.status === "running";

  // Tick once a second while running so the count-up climbs. A pinned `now`
  // (tests) freezes the clock, and a paused session needs no ticking at all.
  useEffect(() => {
    if (now || !isRunning) {
      return;
    }
    const interval = setInterval(
      () => setReference(new Date().toISOString()),
      1000,
    );
    return () => clearInterval(interval);
  }, [now, isRunning]);

  // The soonest upcoming, undeleted commitment — a compact cue, nothing more.
  const nextCommitment = useLiveQuery(
    () =>
      db.events
        .where("startAt")
        .aboveOrEqual(reference)
        .filter((event) => event.deletedAt === null)
        .first(),
    [db, reference],
  );

  const [expanded, setExpanded] = useState(false);
  const [distraction, setDistraction] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const distractionInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  const seconds = elapsedSeconds(focusStateOf(session), reference);
  const title = task?.title ?? "your task";
  const reachedEstimate = hasReachedEstimate(
    seconds,
    task?.estimateMinutes ?? null,
  );

  async function onSaveDistraction(event: React.FormEvent) {
    event.preventDefault();
    const text = distraction.trim();
    if (text === "") {
      return;
    }
    await captureDistraction(db, session.id, text);
    void sync();
    // Clear, confirm subtly, and return attention to the Task without leaving.
    setDistraction("");
    setSavedNotice(true);
    distractionInput.current?.focus();
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = setTimeout(
      () => setSavedNotice(false),
      DISTRACTION_NOTICE_MS,
    );
  }

  async function completeAndCollapse() {
    setExpanded(false);
    await onComplete();
  }

  const controls = (
    <>
      {isRunning ? (
        <Button
          onClick={async () => {
            await pauseFocus(db, session.id);
            void sync();
          }}
          variant="outline"
        >
          Pause
        </Button>
      ) : (
        <Button
          onClick={async () => {
            await resumeFocus(db, session.id);
            void sync();
          }}
          variant="outline"
        >
          Resume
        </Button>
      )}
      <Button onClick={() => void completeAndCollapse()}>Complete</Button>
    </>
  );

  const distractionCapture = (
    <form className="flex flex-col gap-1.5" onSubmit={onSaveDistraction}>
      <label
        className="text-sm text-muted-foreground"
        htmlFor={`distraction-${session.id}`}
      >
        Something on your mind? Park it and stay here.
      </label>
      <div className="flex items-center gap-2">
        <Input
          autoComplete="off"
          id={`distraction-${session.id}`}
          onChange={(event) => setDistraction(event.target.value)}
          placeholder="Capture a distraction…"
          ref={distractionInput}
          value={distraction}
        />
        <Button
          disabled={distraction.trim() === ""}
          type="submit"
          variant="outline"
        >
          Save
        </Button>
      </div>
      <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {savedNotice ? "Saved to Inbox." : null}
      </p>
    </form>
  );

  const estimateCue = reachedEstimate ? (
    <p
      className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
      role="status"
    >
      {FOCUS_ESTIMATE_REACHED_MESSAGE}
    </p>
  ) : null;

  const commitmentCue = nextCommitment
    ? commitmentCueText(
        nextCommitment.title,
        nextCommitment.startAt,
        reference,
        timeZone,
        locale,
      )
    : null;

  const timer = (
    <div>
      <p
        aria-label={`Elapsed time ${formatElapsed(seconds)}`}
        className={cn(
          "font-mono tabular-nums",
          expanded ? "text-6xl" : "text-4xl",
        )}
        role="timer"
      >
        {formatElapsed(seconds)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isRunning ? "Counting up — no rush." : "Paused."}
      </p>
    </div>
  );

  return (
    <div
      aria-label="Focus session"
      className="rounded-xl border bg-card p-6 text-card-foreground"
    >
      <p className="text-sm text-muted-foreground">Focusing on</p>
      <p className="mt-1 text-lg font-medium">{title}</p>

      <div className="mt-4">{timer}</div>

      {session.syncState === "conflict" ? (
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          This session is already running on another device.
        </p>
      ) : null}

      {commitmentCue ? (
        <p className="mt-3 text-sm text-muted-foreground">{commitmentCue}</p>
      ) : null}

      {estimateCue ? <div className="mt-3">{estimateCue}</div> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {controls}
        <Button onClick={() => setExpanded(true)} variant="ghost">
          Enter focus view
        </Button>
      </div>

      <div className="mt-4 border-t pt-4">{distractionCapture}</div>

      <Dialog.Root onOpenChange={setExpanded} open={expanded}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-background/80 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
          <Dialog.Popup
            className={cn(
              "fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background p-6 text-center",
              "transition duration-200 ease-out outline-none data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 motion-reduce:transition-none",
            )}
          >
            <div className="flex w-full max-w-md flex-col items-center gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Focusing on</p>
                <Dialog.Title className="mt-1 text-2xl font-medium">
                  {title}
                </Dialog.Title>
              </div>

              <div className="flex flex-col items-center">{timer}</div>

              {commitmentCue ? (
                <p className="text-sm text-muted-foreground">{commitmentCue}</p>
              ) : null}

              {estimateCue}

              <div className="flex flex-wrap justify-center gap-2">
                {controls}
              </div>

              <div className="w-full text-left">{distractionCapture}</div>

              <Dialog.Close render={<Button variant="ghost" />}>
                Exit focus view
              </Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/**
 * A compact, non-alarming cue for the next commitment. Within 15 minutes it
 * counts down in minutes; further out it names the clock time. Nothing here
 * implies lateness — it only keeps time-bound context visible during focus.
 */
function commitmentCueText(
  title: string,
  startAt: string,
  now: string,
  timeZone: string,
  locale: string,
): string | null {
  const minutes = durationMinutesBetween(now, startAt);
  if (minutes < 0 || minutes > CUE_HORIZON_MINUTES) {
    return null;
  }
  if (minutes <= 15) {
    const unit = minutes === 1 ? "minute" : "minutes";
    return `Coming up in ${minutes} ${unit}: ${title}`;
  }
  return `Coming up at ${formatTime(startAt, timeZone, locale)}: ${title}`;
}
