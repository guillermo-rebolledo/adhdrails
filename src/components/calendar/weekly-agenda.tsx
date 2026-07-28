"use client";

import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";

import {
  type AgendaDay,
  groupEventsByDay,
  weekBounds,
} from "@/domain/calendar/agenda";
import { formatDayHeading } from "@/domain/calendar/format";
import type { RailsDatabase } from "@/offline/db";
import {
  type EventWindow,
  fetchEventWindow,
  syncCalendarMirror,
} from "@/offline/event-pull";
import { useOffline } from "@/offline/provider";

import { type AgendaEvent, EventCard } from "./event-card";
import { mirrorStatusLabel } from "./mirror-status";

/**
 * Builds the query function that imports the Google mirror and hydrates one
 * week window into Dexie. `db` is passed in (not closed over from the hook) so
 * the query key alone — which carries `db.name` — identifies the cache entry.
 */
function loadMirror(db: RailsDatabase, window: EventWindow) {
  return async () => {
    const result = await syncCalendarMirror();
    await fetchEventWindow(db, window);
    return result;
  };
}

/**
 * The weekly agenda. It reads the current week's Events straight from the Dexie
 * replica via `useLiveQuery`, so an Event a user creates appears immediately and
 * the agenda works fully offline — no Google Calendar access required. Both
 * layouts render the identical grouped data for complete desktop/mobile feature
 * parity: desktop shows a seven-column grid to compare the week at a glance;
 * mobile shows the same seven days stacked vertically for a narrow screen.
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
  const bounds = weekBounds(reference, timeZone);

  // Import the Google mirror, then hydrate this week's window into Dexie so the
  // live query below shows imported Events. The agenda works fully offline and
  // without Calendar access: a failure here only affects the status cue, never
  // the locally-owned Events already rendered from Dexie.
  const mirror = useQuery({
    queryKey: ["calendar", "mirror", db.name, bounds.startAt, bounds.endAt],
    queryFn: loadMirror(db, { from: bounds.startAt, to: bounds.endAt }),
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

      {/* Desktop: seven-column week grid. */}
      <div
        className="hidden grid-cols-7 gap-2 md:grid"
        data-testid="agenda-week-grid"
      >
        {days.map((day) => (
          <DayColumn
            day={day}
            key={day.date}
            locale={locale}
            stale={stale}
            timeZone={timeZone}
          />
        ))}
      </div>

      {/* Mobile: the same seven days, stacked vertically. */}
      <ol
        className="flex flex-col gap-4 md:hidden"
        data-testid="agenda-week-list"
      >
        {days.map((day) => (
          <li key={day.date}>
            <DayColumn
              day={day}
              locale={locale}
              stale={stale}
              timeZone={timeZone}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function DayColumn({
  day,
  timeZone,
  locale,
  stale,
}: {
  day: AgendaDay<AgendaEvent>;
  timeZone: string;
  locale: string;
  stale?: boolean;
}) {
  const heading = formatDayHeading(day.date, timeZone, locale);

  return (
    <section aria-label={heading} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">{heading}</h3>
      {day.events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No events</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {day.events.map((event) => (
            <li key={event.id}>
              <EventCard
                event={event}
                locale={locale}
                stale={stale}
                timeZone={timeZone}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
