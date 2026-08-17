"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { Button, buttonVariants } from "@/components/ui/button";
import { TASK_COMPLETED_MESSAGE } from "@/domain/task/task";
import type { LocalTask } from "@/offline/db";
import {
  completeTask,
  deleteTaskLocally,
  finalizeTaskDeletion,
  restoreTask,
  uncompleteTask,
} from "@/offline/task-commands";
import { useOffline } from "@/offline/provider";
import { cn } from "@/lib/utils";

/** How long an app-owned deletion can be undone before it finalizes. */
const UNDO_WINDOW_MS = 10_000;
/** How long the calm completion acknowledgement (and its Undo) stays visible. */
const COMPLETION_NOTICE_MS = 8_000;
/**
 * How long a removed row is held on screen to collapse out of the list. Matches
 * `--motion-calm` in `globals.css`; the row is unmounted once it finishes, so a
 * value longer than the CSS duration would leave an invisible row occupying the
 * list and a shorter one would cut the collapse off partway.
 */
const ROW_EXIT_MS = 260;

interface Ack {
  id: string;
  title: string;
}

/** A row mid-collapse, with the slot it held in the caller's list. */
interface ExitingRow {
  task: LocalTask;
  index: number;
}

/**
 * The Available Tasks list on Today. It reads active Tasks straight from the
 * Dexie replica, so work appears whether online or offline. Completing a Task
 * shows a calm acknowledgement with a brief Undo — no scores, streaks, or
 * overdue language. Deleting a Task hides it immediately and offers a 10-second
 * Undo; once the window elapses the deletion finalizes and its 30-day
 * synchronization tombstone is written.
 */
export function TaskItems({
  tasks,
  emptyMessage = "No tasks yet. Anything you capture and turn into a task will wait here.",
  undoWindowMs = UNDO_WINDOW_MS,
  completionNoticeMs = COMPLETION_NOTICE_MS,
  rowExitMs = ROW_EXIT_MS,
}: {
  tasks: LocalTask[];
  emptyMessage?: string;
  /** The delete Undo window. Overridable only to keep tests fast. */
  undoWindowMs?: number;
  /** The completion Undo window. Overridable only to keep tests fast. */
  completionNoticeMs?: number;
  /**
   * How long a removed row is held to collapse. Overridable only so a test can
   * assert on the collapsing row without racing a 260ms window.
   */
  rowExitMs?: number;
}) {
  const { db, sync } = useOffline();

  const [completed, setCompleted] = useState<Ack | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Ack | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeleteId = useRef<string | null>(null);
  const completionFinalized = useRef(true);

  /*
   * Rows on their way out.
   *
   * Completing or deleting writes to Dexie, and the live query drops the row on
   * its next emission — so the row the user just acted on vanished between one
   * frame and the next while the acknowledgement below faded in politely over
   * 150ms. The most consequential moment in the list was the only one with no
   * motion at all, and everything underneath jumped up to fill the gap.
   *
   * Holding a snapshot of the row for one collapse lets it leave the way it
   * arrived, and lets the list close over it instead of snapping. These are
   * snapshots, not live records: the underlying row is already gone from the
   * query by the time they render.
   */
  const [exiting, setExiting] = useState<ExitingRow[]>([]);
  const exitTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  function beginExit(task: LocalTask) {
    // Capture the row's position now, while it is still in the caller's list.
    // Once the write lands it is gone from `tasks` and there is nothing left to
    // derive a position from.
    const index = tasks.findIndex((row) => row.id === task.id);
    setExiting((current) =>
      current.some((row) => row.task.id === task.id)
        ? current
        : [...current, { task, index: index === -1 ? tasks.length : index }],
    );
    const existing = exitTimers.current.get(task.id);
    if (existing) {
      clearTimeout(existing);
    }
    exitTimers.current.set(
      task.id,
      setTimeout(() => {
        exitTimers.current.delete(task.id);
        setExiting((current) =>
          current.filter((row) => row.task.id !== task.id),
        );
      }, rowExitMs),
    );
  }

  /** Drops a row out of the exit set immediately — used when Undo restores it. */
  function cancelExit(id: string) {
    const timer = exitTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      exitTimers.current.delete(id);
    }
    setExiting((current) => current.filter((row) => row.task.id !== id));
  }

  /*
   * The rows to render: the caller's list exactly as given, with anything still
   * collapsing spliced back into the slot it occupied.
   *
   * The caller's order is not ours to reproduce. The Tasks collections view
   * orders by the server's page sequence and deliberately keeps local-only,
   * unsynced Tasks after the server-backed ones; re-deriving an order here —
   * even one that happens to match what Today does — would interleave an
   * optimistic Task among server rows and quietly override that decision.
   *
   * Re-inserting by remembered index sidesteps the question entirely: whatever
   * the caller ordered, a leaving row collapses where it sat. Ascending index
   * order matters, because each remembered index refers to a list that already
   * contains the rows inserted before it. An id in both lists is dropped from
   * the exit set — a restored row is a real row again, and the live one wins.
   */
  const liveIds = new Set(tasks.map((task) => task.id));
  const visibleRows = [...tasks];
  for (const row of exiting
    .filter(({ task }) => !liveIds.has(task.id))
    .sort((left, right) => left.index - right.index)) {
    visibleRows.splice(Math.min(row.index, visibleRows.length), 0, row.task);
  }

  // Finalize any still-pending mutation on unmount so it is never silently lost.
  useEffect(() => {
    // Captured on mount rather than read in the cleanup: the cleanup runs after
    // the component is gone, and the exit timers it has to clear are the ones
    // that belonged to this instance.
    const timers = exitTimers.current;
    return () => {
      if (completionTimer.current) {
        clearTimeout(completionTimer.current);
      }
      if (!completionFinalized.current) {
        completionFinalized.current = true;
        void sync();
      }
      if (deleteTimer.current) {
        clearTimeout(deleteTimer.current);
      }
      if (pendingDeleteId.current) {
        void finalizeTaskDeletion(db, pendingDeleteId.current);
      }
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, [db, sync]);

  /** Flushes a held completion once its Undo window is no longer available. */
  function finalizeCompletion() {
    if (completionTimer.current) {
      clearTimeout(completionTimer.current);
      completionTimer.current = null;
    }
    if (!completionFinalized.current) {
      completionFinalized.current = true;
      void sync();
    }
    setCompleted(null);
  }

  async function onComplete(task: LocalTask) {
    // Commit an earlier held completion before offering Undo for another one.
    finalizeCompletion();
    // A newly created or edited Task may still have an older request in flight.
    // Let that drain reconcile before applying completion so its stale server
    // response cannot restore the Task to active during the Undo window.
    if (task.syncState !== "synced") {
      await sync();
    }
    beginExit(task);
    await completeTask(db, task.id);
    completionFinalized.current = false;
    setCompleted({ id: task.id, title: task.title });
    completionTimer.current = setTimeout(
      finalizeCompletion,
      completionNoticeMs,
    );
  }

  async function onUndoComplete() {
    if (!completed) {
      return;
    }
    if (completionTimer.current) {
      clearTimeout(completionTimer.current);
      completionTimer.current = null;
    }
    // The completion has not been delivered yet, so this active update replaces
    // it in the pending outbox entry before the first synchronization.
    completionFinalized.current = true;
    cancelExit(completed.id);
    await uncompleteTask(db, completed.id);
    setCompleted(null);
    void sync();
  }

  async function onRestore(task: LocalTask) {
    await uncompleteTask(db, task.id);
    void sync();
  }

  async function finalizeNow(id: string) {
    if (deleteTimer.current) {
      clearTimeout(deleteTimer.current);
      deleteTimer.current = null;
    }
    pendingDeleteId.current = null;
    await finalizeTaskDeletion(db, id);
    void sync();
    setPendingDelete((current) => (current?.id === id ? null : current));
  }

  async function onDelete(task: LocalTask) {
    // Only one deletion is tracked at a time; commit any earlier one first.
    if (pendingDeleteId.current && pendingDeleteId.current !== task.id) {
      await finalizeNow(pendingDeleteId.current);
    }
    beginExit(task);
    await deleteTaskLocally(db, task.id);
    pendingDeleteId.current = task.id;
    setPendingDelete({ id: task.id, title: task.title });
    deleteTimer.current = setTimeout(() => {
      void finalizeNow(task.id);
    }, undoWindowMs);
  }

  async function onUndoDelete() {
    if (!pendingDelete) {
      return;
    }
    if (deleteTimer.current) {
      clearTimeout(deleteTimer.current);
      deleteTimer.current = null;
    }
    pendingDeleteId.current = null;
    cancelExit(pendingDelete.id);
    await restoreTask(db, pendingDelete.id);
    setPendingDelete(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite" className="flex flex-col gap-2">
        {completed ? (
          <div
            className="flex animate-in items-center justify-between gap-4 rounded-lg border bg-muted/40 p-3 text-sm duration-(--motion-quick) ease-enter fade-in-0"
            role="status"
          >
            <span>{TASK_COMPLETED_MESSAGE}</span>
            <Button onClick={onUndoComplete} size="sm" variant="ghost">
              Undo
            </Button>
          </div>
        ) : null}
        {pendingDelete ? (
          <div
            className="flex animate-in items-center justify-between gap-4 rounded-lg border bg-muted/40 p-3 text-sm duration-(--motion-quick) ease-enter fade-in-0"
            role="status"
          >
            <span>Task deleted.</span>
            <Button onClick={onUndoDelete} size="sm" variant="ghost">
              Undo
            </Button>
          </div>
        ) : null}
      </div>

      {visibleRows.length === 0 ? (
        <p className="text-muted-foreground">{emptyMessage}</p>
      ) : (
        /*
         * The gap between rows lives inside each row (`pb-2` on the clipped
         * wrapper) rather than on the list. A flex `gap-2` is drawn between
         * children regardless of their height, so a row collapsing to zero
         * would still leave its gap behind and the list would close in two
         * steps — the row first, then the space it left. Folding the spacing
         * into the collapsing box makes it one movement.
         */
        <ul aria-label="Available tasks" className="flex flex-col">
          {visibleRows.map((task) => {
            const isExiting = exiting.some((row) => row.task.id === task.id);
            return (
              <li
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-(--motion-calm) ease-exit motion-reduce:transition-none",
                  isExiting ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
                )}
                key={task.id}
                // A row mid-collapse is a receipt, not a control: its buttons
                // must not be clickable or focusable on the way out.
                inert={isExiting}
              >
                <div className="overflow-hidden pb-2">
                  <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <span className="min-w-0 break-words sm:truncate">
                      {task.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                      {task.status === "active" ? (
                        <Button
                          onClick={() => onComplete(task)}
                          size="sm"
                          variant="secondary"
                        >
                          Complete
                        </Button>
                      ) : (
                        <Button
                          onClick={() => onRestore(task)}
                          size="sm"
                          variant="secondary"
                        >
                          Restore
                        </Button>
                      )}
                      <Link
                        className={buttonVariants({
                          size: "sm",
                          variant: "ghost",
                        })}
                        href={`/tasks/${task.id}/edit`}
                      >
                        Edit
                      </Link>
                      <Button
                        aria-label={`Delete ${task.title}`}
                        onClick={() => onDelete(task)}
                        size="sm"
                        variant="ghost"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The compact Available Tasks list used on Today. The full Tasks destination
 * uses {@link TaskItems} with server-paginated collection membership instead.
 */
export function TaskList({
  undoWindowMs = UNDO_WINDOW_MS,
  completionNoticeMs = COMPLETION_NOTICE_MS,
}: {
  /** The delete Undo window. Overridable only to keep tests fast. */
  undoWindowMs?: number;
  /** The completion Undo window. Overridable only to keep tests fast. */
  completionNoticeMs?: number;
} = {}) {
  const { db } = useOffline();
  const tasks = useLiveQuery(
    () =>
      db.tasks
        .where("status")
        .equals("active")
        .filter((task) => task.deletedAt === null)
        .sortBy("createdAt"),
    [db],
  );

  if (tasks === undefined) {
    return null;
  }

  return (
    <TaskItems
      completionNoticeMs={completionNoticeMs}
      tasks={tasks}
      undoWindowMs={undoWindowMs}
    />
  );
}
