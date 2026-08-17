"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";

import { Temporal } from "temporal-polyfill";

import { useClock } from "@/components/account/time-zone-provider";
import { Button } from "@/components/ui/button";
import {
  TASK_COLLECTIONS,
  TASK_COLLECTION_MAX_PAGES,
  TASK_COLLECTION_WINDOW_SIZE,
  type TaskCollection,
  type TaskEnergyFilter,
  taskMatchesCollection,
  taskMatchesFilters,
} from "@/domain/task/collection";
import type { LocalTask, RailsDatabase } from "@/offline/db";
import { useOffline } from "@/offline/provider";
import { fetchTaskCollectionPage } from "@/offline/task-pull";
import { cn } from "@/lib/utils";

import { TaskItems } from "./task-list";

const COLLECTION_LABELS: Record<TaskCollection, string> = {
  today: "Today",
  upcoming: "Upcoming",
  anytime: "Anytime",
  completed: "Completed",
};

const EMPTY_MESSAGES: Record<TaskCollection, string> = {
  today: "Nothing is scheduled for today.",
  upcoming: "Nothing is scheduled for later.",
  anytime: "No tasks yet. Unscheduled work will stay visible here.",
  completed: "Completed tasks will rest here.",
};

function uniqueTasks(tasks: readonly LocalTask[]): LocalTask[] {
  return [...new Map(tasks.map((task) => [task.id, task])).values()];
}

interface TaskPageParam {
  cursor: string | null;
  direction: "forward" | "backward";
}

function taskPageLoader(
  db: RailsDatabase,
  request: Omit<
    Parameters<typeof fetchTaskCollectionPage>[1],
    "cursor" | "direction"
  >,
) {
  return ({ pageParam }: { pageParam: TaskPageParam }) =>
    fetchTaskCollectionPage(db, { ...request, ...pageParam });
}

/**
 * The full Tasks inventory. TanStack Query owns only cursor-page membership and
 * order; fetched entities reconcile into Dexie, which remains authoritative for
 * optimistic and offline state. Filters are opt-in and clear together.
 */
export function TaskCollections({
  today: todayOverride,
  ...overrides
}: {
  /** Today's local date. Supplied only for standalone renders and tests. */
  today?: string;
  timeZone?: string;
} = {}) {
  const { timeZone } = useClock(overrides);
  // Derived from the app clock rather than fixed by the server: "today" is the
  // one value on this screen that moves with the user's zone, and a server that
  // does not yet know that zone would otherwise scope the list to the wrong day.
  const today =
    todayOverride ??
    Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate().toString();
  const { db } = useOffline();
  const [collection, setCollection] = useState<TaskCollection>("anytime");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [energy, setEnergy] = useState<TaskEnergyFilter | null>(null);
  const [localOffset, setLocalOffset] = useState(0);

  const areas =
    useLiveQuery(() => db.areas.orderBy("name").toArray(), [db]) ?? [];

  const query = useInfiniteQuery({
    queryKey: ["tasks", db.name, collection, today, areaId, energy],
    queryFn: taskPageLoader(db, { collection, today, areaId, energy }),
    initialPageParam: {
      cursor: null,
      direction: "forward",
    } satisfies TaskPageParam,
    getNextPageParam: (lastPage): TaskPageParam | undefined =>
      lastPage.nextCursor
        ? { cursor: lastPage.nextCursor, direction: "forward" }
        : undefined,
    getPreviousPageParam: (firstPage): TaskPageParam | undefined =>
      firstPage.previousCursor
        ? { cursor: firstPage.previousCursor, direction: "backward" }
        : undefined,
    maxPages: TASK_COLLECTION_MAX_PAGES,
  });

  const pageIds = useMemo(
    () => query.data?.pages.flatMap((page) => page.ids) ?? [],
    [query.data],
  );
  const pageIdsKey = pageIds.join(",");
  const hasServerView = query.data !== undefined;

  const taskView = useLiveQuery(async () => {
    let candidates: LocalTask[];
    if (!hasServerView) {
      const status = collection === "completed" ? "completed" : "active";
      const localRows = await db.tasks
        .where("[status+createdAt+id]")
        .between([status, "", ""], [status, "\uffff", "\uffff"])
        .filter(
          (task) =>
            taskMatchesCollection(task, collection, today) &&
            taskMatchesFilters(task, { areaId, energy }, collection),
        )
        .offset(localOffset)
        .limit(TASK_COLLECTION_WINDOW_SIZE + 1)
        .toArray();
      return {
        tasks: localRows.slice(0, TASK_COLLECTION_WINDOW_SIZE),
        hasPrevious: localOffset > 0,
        hasMore: localRows.length > TASK_COLLECTION_WINDOW_SIZE,
      };
    } else {
      const paged = (await db.tasks.bulkGet(pageIds)).filter(
        (task): task is LocalTask => task !== undefined,
      );
      const optimistic = await db.tasks
        .where("syncState")
        .notEqual("synced")
        .filter(
          (task) =>
            taskMatchesCollection(task, collection, today) &&
            taskMatchesFilters(task, { areaId, energy }, collection),
        )
        .limit(TASK_COLLECTION_WINDOW_SIZE)
        .toArray();
      candidates = uniqueTasks([...paged, ...optimistic]);
    }

    const position = new Map(pageIds.map((id, index) => [id, index]));
    return {
      tasks: candidates
        .filter(
          (task) =>
            taskMatchesCollection(task, collection, today) &&
            taskMatchesFilters(task, { areaId, energy }, collection),
        )
        .sort((left, right) => {
          const leftPosition = position.get(left.id);
          const rightPosition = position.get(right.id);
          if (leftPosition !== undefined && rightPosition !== undefined) {
            return leftPosition - rightPosition;
          }
          if (leftPosition !== undefined) return -1;
          if (rightPosition !== undefined) return 1;
          return (
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id)
          );
        }),
      hasPrevious: false,
      hasMore: false,
    };
  }, [
    db,
    hasServerView,
    pageIdsKey,
    collection,
    today,
    areaId,
    energy,
    localOffset,
  ]);

  const filtersActive = areaId !== null || energy !== null;
  // `useLiveQuery` may retain its previous result for one render while its
  // async query reruns. Re-apply the current public predicates synchronously so
  // switching views never flashes a Task from the old collection.
  const visibleTasks = taskView?.tasks.filter(
    (task) =>
      taskMatchesCollection(task, collection, today) &&
      taskMatchesFilters(task, { areaId, energy }, collection),
  );

  function selectCollection(next: TaskCollection) {
    setCollection(next);
    setLocalOffset(0);
    if (next === "today" || next === "upcoming") {
      setEnergy(null);
    }
  }

  function moveView(
    current: TaskCollection,
    key: "ArrowLeft" | "ArrowRight" | "Home" | "End",
  ) {
    const currentIndex = TASK_COLLECTIONS.indexOf(current);
    const nextIndex =
      key === "Home"
        ? 0
        : key === "End"
          ? TASK_COLLECTIONS.length - 1
          : (currentIndex +
              (key === "ArrowRight" ? 1 : -1) +
              TASK_COLLECTIONS.length) %
            TASK_COLLECTIONS.length;
    const next = TASK_COLLECTIONS[nextIndex];
    selectCollection(next);
    document.getElementById(`task-tab-${next}`)?.focus();
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        aria-label="Task views"
        className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1"
        role="tablist"
      >
        {TASK_COLLECTIONS.map((value) => (
          <button
            aria-controls="task-collection-panel"
            aria-selected={collection === value}
            className={cn(
              "min-h-9 flex-1 rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              collection === value
                ? "bg-background text-foreground shadow-sm"
                : "text-foreground hover:bg-background/60",
            )}
            id={`task-tab-${value}`}
            key={value}
            onKeyDown={(event) => {
              if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight" ||
                event.key === "Home" ||
                event.key === "End"
              ) {
                event.preventDefault();
                moveView(value, event.key);
              }
            }}
            onClick={() => selectCollection(value)}
            role="tab"
            tabIndex={collection === value ? 0 : -1}
            type="button"
          >
            {COLLECTION_LABELS[value]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          Filter by area
          <select
            className="h-9 rounded-lg border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onChange={(event) => {
              setAreaId(event.target.value || null);
              setLocalOffset(0);
            }}
            value={areaId ?? ""}
          >
            <option value="">All areas</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          Filter by energy
          <select
            className="h-9 rounded-lg border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            disabled={collection === "today" || collection === "upcoming"}
            onChange={(event) => {
              setEnergy(
                (event.target.value || null) as TaskEnergyFilter | null,
              );
              setLocalOffset(0);
            }}
            value={energy ?? ""}
          >
            <option value="">All energy</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="unset">Not set</option>
          </select>
        </label>

        <Button
          disabled={!filtersActive}
          onClick={() => {
            setAreaId(null);
            setEnergy(null);
            setLocalOffset(0);
          }}
          variant="ghost"
        >
          Clear filters
        </Button>
      </div>

      <div
        aria-labelledby={`task-tab-${collection}`}
        id="task-collection-panel"
        role="tabpanel"
      >
        {query.status === "pending" &&
        (!visibleTasks || visibleTasks.length === 0) ? (
          <p className="text-sm text-muted-foreground">Loading tasks…</p>
        ) : null}
        {query.status === "error" ? (
          <p className="mb-3 text-sm text-muted-foreground" role="status">
            Showing saved tasks while the connection is unavailable.
          </p>
        ) : null}
        {visibleTasks &&
        (query.status !== "pending" || visibleTasks.length > 0) ? (
          <TaskItems
            emptyMessage={EMPTY_MESSAGES[collection]}
            tasks={visibleTasks}
          />
        ) : null}
      </div>

      {query.hasPreviousPage || (!hasServerView && taskView?.hasPrevious) ? (
        <Button
          className="self-start"
          disabled={query.isFetchingPreviousPage}
          onClick={() => {
            if (hasServerView) {
              void query.fetchPreviousPage();
            } else {
              setLocalOffset((offset) =>
                Math.max(0, offset - TASK_COLLECTION_WINDOW_SIZE),
              );
            }
          }}
          variant="outline"
        >
          {query.isFetchingPreviousPage ? "Loading…" : "Load previous"}
        </Button>
      ) : null}

      {query.hasNextPage || (!hasServerView && taskView?.hasMore) ? (
        <Button
          className="self-start"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            if (hasServerView) {
              void query.fetchNextPage();
            } else {
              setLocalOffset((offset) => offset + TASK_COLLECTION_WINDOW_SIZE);
            }
          }}
          variant="outline"
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
