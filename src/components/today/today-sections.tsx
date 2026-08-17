"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarIcon,
  ChevronRightIcon,
  InboxIcon,
  LightbulbIcon,
  ListTodoIcon,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";

import { TaskList } from "@/components/task/task-list";
import { buttonVariants } from "@/components/ui/button";
import { useOffline } from "@/offline/provider";
import { cn } from "@/lib/utils";

/**
 * Live count of active, non-deleted Tasks in the local replica. Used as the
 * first-run signal: an account with no Tasks yet gets orientation instead of an
 * empty manage-list. Returns `undefined` while the replica is still loading so
 * callers can avoid a content flash.
 */
function useActiveTaskCount(): number | undefined {
  const { db } = useOffline();
  return useLiveQuery(
    () =>
      db.tasks
        .where("status")
        .equals("active")
        .filter((task) => task.deletedAt === null)
        .count(),
    [db],
  );
}

const ORIENTATION_LINKS = [
  { href: "/inbox", label: "Capture a thought", icon: InboxIcon },
  { href: "/tasks", label: "Focus on one task", icon: ListTodoIcon },
  { href: "/calendar", label: "See your week", icon: CalendarIcon },
  { href: "/thoughts", label: "Keep a thought", icon: LightbulbIcon },
] as const;

/**
 * A quiet, first-run only orientation. When the account has no Tasks yet, it
 * names what Rails is for in one line and offers a few labelled entry points, so
 * a new user can tell what they're able to do without a modal tour. It disappears
 * the moment there is real work to focus on.
 */
export function TodayOrientation() {
  const count = useActiveTaskCount();

  if (count === undefined || count > 0) {
    return null;
  }

  return (
    <section
      aria-label="Getting started with Rails"
      className="flex flex-col gap-3 rounded-xl border border-dashed bg-muted/30 p-4"
    >
      <p className="text-sm text-muted-foreground">
        New here? Jot anything into Quick Capture above — Rails keeps it safe.
        From here you can:
      </p>
      <ul className="flex flex-wrap gap-2">
        {ORIENTATION_LINKS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "gap-1.5 font-normal",
              )}
              href={href}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Available Tasks section on Today. It stays out of the way of the primary
 * focus decision: once there are Tasks, the full manage-list (which otherwise
 * repeats the focus recommendation and its alternatives) is tucked behind a
 * quiet, closed-by-default disclosure that shows only its count. A brand-new
 * account sees a calm teaching line instead of an empty list.
 */
export function AvailableTasks() {
  const count = useActiveTaskCount();
  const [open, setOpen] = useState(false);
  // Once the account has had a Task, keep the section available even if the list
  // empties out — so completing or deleting the last Task still shows its
  // acknowledgement and Undo instead of the whole section vanishing. Adjusting
  // state during render (React's endorsed alternative to a setState-in-effect
  // cascade) latches this the moment a count first arrives non-zero.
  const [everHadTasks, setEverHadTasks] = useState(false);
  if (typeof count === "number" && count > 0 && !everHadTasks) {
    setEverHadTasks(true);
  }

  // Still loading the replica — render nothing rather than a flash of the wrong
  // (empty vs. populated) state.
  if (count === undefined) {
    return null;
  }

  // Brand-new account, never any Tasks: the Focus Now empty state already offers
  // "New task" and orientation covers the rest, so an empty manage-list here
  // would only add a third redundant empty message. Stay out of the way.
  if (count === 0 && !everHadTasks) {
    return null;
  }

  // Keep the panel open while empty-after-interaction so the Undo stays visible.
  const panelOpen = open || count === 0;

  return (
    <section aria-label="Available tasks" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <button
          aria-controls="available-tasks-panel"
          aria-expanded={panelOpen}
          className="-ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-lg font-medium hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-(--motion-calm) ease-enter motion-reduce:transition-none",
              panelOpen && "rotate-90",
            )}
          />
          Available tasks
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {count}
          </span>
        </button>
        <Link
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href="/tasks/new"
        >
          New task
        </Link>
      </div>
      {/*
        The chevron rotates to point down, promising the list will open
        downward — so the list has to actually do that. Swapping the panel in
        and out of the tree made it appear fully formed instead, which reads as
        a different, unrelated thing arriving.

        The reveal is a `grid-template-rows` transition from `0fr` to `1fr`: it
        animates to the content's natural height without anyone measuring it,
        and the inner `overflow-hidden` clips the list as it grows. The panel
        stays mounted so the transition has two states to move between, and is
        marked `inert` while closed so hidden rows stay out of the tab order and
        the accessibility tree.
      */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-(--motion-calm) ease-enter motion-reduce:transition-none",
          panelOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div
          className="overflow-hidden"
          id="available-tasks-panel"
          inert={!panelOpen}
        >
          <TaskList />
        </div>
      </div>
    </section>
  );
}
