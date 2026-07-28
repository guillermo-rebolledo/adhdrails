"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { Button } from "@/components/ui/button";
import { elapsedSeconds } from "@/domain/focus/session";
import type { LocalFocusSession } from "@/offline/db";
import {
  focusStateOf,
  pauseFocus,
  resumeFocus,
} from "@/offline/focus-commands";
import { useOffline } from "@/offline/provider";

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

/**
 * The active Focus Session on Today: an expanded, low-distraction card with a
 * count-up timer and the session controls. Pause preserves the elapsed time and
 * is explicitly not "Move to later" (a planning action offered before a session
 * starts); Complete ends the session and never auto-starts another Task. Controls
 * are acknowledged optimistically through the local command layer, so the timer
 * reacts within the performance budget and survives navigation and reopening.
 */
export function FocusSession({
  session,
  onComplete,
  now,
}: {
  session: LocalFocusSession;
  /** Ending the session; the parent shows the calm acknowledgement afterward. */
  onComplete: () => void | Promise<void>;
  /** Reference instant. Defaults to a live clock; injectable to keep tests stable. */
  now?: string;
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

  const seconds = elapsedSeconds(focusStateOf(session), reference);
  const title = task?.title ?? "your task";

  return (
    <div
      aria-label="Focus session"
      className="rounded-xl border bg-card p-6 text-card-foreground"
    >
      <p className="text-sm text-muted-foreground">Focusing on</p>
      <p className="mt-1 text-lg font-medium">{title}</p>

      <p
        aria-label={`Elapsed time ${formatElapsed(seconds)}`}
        className="mt-4 font-mono text-4xl tabular-nums"
        role="timer"
      >
        {formatElapsed(seconds)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isRunning ? "Counting up — no rush." : "Paused."}
      </p>

      {session.syncState === "conflict" ? (
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          This session is already running on another device.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
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
        <Button onClick={() => void onComplete()}>Complete</Button>
      </div>
    </div>
  );
}
