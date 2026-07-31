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

/** How long an app-owned deletion can be undone before it finalizes. */
const UNDO_WINDOW_MS = 10_000;
/** How long the calm completion acknowledgement (and its Undo) stays visible. */
const COMPLETION_NOTICE_MS = 8_000;

interface Ack {
  id: string;
  title: string;
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
}: {
  tasks: LocalTask[];
  emptyMessage?: string;
  /** The delete Undo window. Overridable only to keep tests fast. */
  undoWindowMs?: number;
  /** The completion Undo window. Overridable only to keep tests fast. */
  completionNoticeMs?: number;
}) {
  const { db, sync } = useOffline();

  const [completed, setCompleted] = useState<Ack | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Ack | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeleteId = useRef<string | null>(null);
  const completionFinalized = useRef(true);

  // Finalize any still-pending mutation on unmount so it is never silently lost.
  useEffect(() => {
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
    await restoreTask(db, pendingDelete.id);
    setPendingDelete(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite" className="flex flex-col gap-2">
        {completed ? (
          <div
            className="flex items-center justify-between gap-4 rounded-lg border bg-muted/40 p-3 text-sm animate-in fade-in-0 duration-150 ease-out"
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
            className="flex items-center justify-between gap-4 rounded-lg border bg-muted/40 p-3 text-sm animate-in fade-in-0 duration-150 ease-out"
            role="status"
          >
            <span>Task deleted.</span>
            <Button onClick={onUndoDelete} size="sm" variant="ghost">
              Undo
            </Button>
          </div>
        ) : null}
      </div>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul aria-label="Available tasks" className="flex flex-col gap-2">
          {tasks.map((task) => (
            <li
              className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              key={task.id}
            >
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
                  className={buttonVariants({ size: "sm", variant: "ghost" })}
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
            </li>
          ))}
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
