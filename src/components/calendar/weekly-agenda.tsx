"use client";

import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";

import {
  type AgendaDay,
  groupEventsByDay,
  plainDateInZone,
  weekBounds,
} from "@/domain/calendar/agenda";
import {
  formatDayHeading,
  formatDayHeadingParts,
} from "@/domain/calendar/format";
import { cn } from "@/lib/utils";
import type { RailsDatabase } from "@/offline/db";
import {
  type EventWindow,
  fetchEventWindow,
  syncCalendarMirror,
} from "@/offline/event-pull";
import { useOffline } from "@/offline/provider";

import { AgendaRow } from "./agenda-row";
import type { AgendaEvent } from "./event-card";
import { mirrorStatusLabel } from "./mirror-status";

/**
 * Builds the query function that imports the Google mirror and hydrates one
 * week window into Dexie. `db` is passed in (not closed over from the hook) so
 * the query key alone — which carries `db.name` — identifies the cache entry.
 * Only when the sync actually changed the mirror does it invalidate the Later
 * list — the one *other* view that reads the mirror — so incremental changes
 * beyond the current week converge without churning that list on a no-op sync
 * (which would fight its Load-more pagination). Task views are deliberately left
 * untouched: a Calendar sync never affects them.
 */
function loadMirror(
  db: RailsDatabase,
  window: EventWindow,
  queryClient: QueryClient,
) {
  return async () => {
    const result = await syncCalendarMirror();
    await fetchEventWindow(db, window);
    if (result && (result.imported > 0 || result.removed > 0)) {
      await queryClient.invalidateQueries({ queryKey: ["events"] });
    }
    return result;
  };
}

/**
 * The weekly agenda. It reads the current week's Events straight from the Dexie
 * replica via `useLiveQuery`, so an Event a user creates appears immediately and
 * the agenda works fully offline — no Google Calendar access required.
 *
 * The seven days stack vertically at every width — one layout, one DOM, so
 * desktop and mobile can never drift apart and assistive technology never meets
 * the same week twice. A seven-column grid gave each day a fraction of the page
 * width, which truncated titles to a few characters and wrapped time-zone notes
 * over several lines; a vertical rail spends the width on the part that carries
 * the meaning. Days keep their full seven-column ordering, empty ones included,
 * so the shape of the week stays legible.
 */
export function WeeklyAgenda({
  reference,
  timeZone,
  locale,
}: {
  /** The instant whose week to show (usually now), as an ISO string. */
  reference: string;
  timeZone: string;
  locale: string;
}) {
  const { db } = useOffline();
  const queryClient = useQueryClient();
  const bounds = weekBounds(reference, timeZone);

  // Import the Google mirror, then hydrate this week's window into Dexie so the
  // live query below shows imported Events. The agenda works fully offline and
  // without Calendar access: a failure here only affects the status cue, never
  // the locally-owned Events already rendered from Dexie.
  const mirror = useQuery({
    queryKey: ["calendar", "mirror", db.name, bounds.startAt, bounds.endAt],
    queryFn: loadMirror(
      db,
      { from: bounds.startAt, to: bounds.endAt },
      queryClient,
    ),
    staleTime: 60_000,
    retry: false,
  });

  const events = useLiveQuery(
    () =>
      db.events
        .where("startAt")
        .between(bounds.startAt, bounds.endAt, true, false)
        .filter((event) => event.deletedAt === null)
        .toArray(),
    [db, bounds.startAt, bounds.endAt],
  );

  if (events === undefined) {
    return null;
  }

  const days = groupEventsByDay(events as AgendaEvent[], reference, timeZone);
  const status = mirrorStatusLabel({
    isSyncing: mirror.isFetching,
    isError: mirror.isError,
    lastSyncedAt: mirror.data?.lastSyncedAt ?? null,
    timeZone,
    locale,
  });
  // Imported Events are marked stale whenever the mirror's freshness is not
  // confirmed — while a refresh is in flight, or when the last sync failed and
  // Dexie is showing cached data — so old data is never mistaken for current.
  // This is distinct from a per-Event "pending" cue, which flags a local change
  // that has not yet reached the server.
  const stale = mirror.isFetching || mirror.isError;
  // `reference` is the instant the screen was opened, so its local date is
  // today — derived rather than read from the clock again, which keeps the
  // highlighted day stable for the session and deterministic in tests.
  const today = plainDateInZone(reference, timeZone);

  return (
    <div className="flex flex-col gap-3">
      {status ? (
        <p
          aria-live="polite"
          className="text-xs text-muted-foreground"
          role="status"
        >
          {status}
        </p>
      ) : null}

      <ol
        className="divide-y overflow-hidden rounded-xl border bg-card"
        data-testid="agenda-week"
      >
        {days.map((day) => (
          <DaySection
            day={day}
            key={day.date}
            locale={locale}
            stale={stale}
            timeZone={timeZone}
            today={day.date === today}
          />
        ))}
      </ol>
    </div>
  );
}

function DaySection({
  day,
  timeZone,
  locale,
  stale,
  today,
}: {
  day: AgendaDay<AgendaEvent>;
  timeZone: string;
  locale: string;
  stale?: boolean;
  today: boolean;
}) {
  const heading = formatDayHeading(day.date, timeZone, locale);
  const parts = formatDayHeadingParts(day.date, timeZone, locale);
  const empty = day.events.length === 0;

  return (
    <li
      className={cn(
        "flex flex-col gap-2 px-4 py-4 sm:flex-row sm:gap-6 sm:px-5",
        empty && "sm:py-3",
        // Today reads as a calm tint rather than an alert. The dark theme needs
        // its own value: the same alpha over a near-black card is invisible.
        today && "bg-primary/[0.04] dark:bg-primary/[0.12]",
      )}
    >
      {/* The date is one heading for assistive technology and a stacked label
          for the eye, so a screen reader hears "Mon, Jul 20" rather than three
          disconnected fragments. */}
      <h3 className="sr-only">{heading}</h3>
      <p
        aria-hidden="true"
        className="flex shrink-0 items-baseline gap-2 sm:w-24 sm:flex-col sm:gap-0"
      >
        <span
          className={cn(
            "text-xs font-medium tracking-wide uppercase",
            today ? "text-primary" : "text-muted-foreground",
          )}
        >
          {parts.weekday}
        </span>
        <span
          className={cn(
            "text-2xl leading-tight font-semibold tabular-nums",
            empty && "text-muted-foreground/60",
          )}
        >
          {parts.day}
        </span>
        <span className="text-xs text-muted-foreground">{parts.month}</span>
      </p>

      <div className="min-w-0 flex-1">
        {empty ? (
          <p className="text-sm text-muted-foreground/70 sm:pt-1">No events</p>
        ) : (
          <ul className="flex flex-col">
            {day.events.map((event) => (
              <AgendaRow
                event={event}
                key={event.id}
                locale={locale}
                stale={stale}
                timeZone={timeZone}
              />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
