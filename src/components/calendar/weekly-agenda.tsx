"use client";

import { useLiveQuery } from "dexie-react-hooks";

import {
  type AgendaDay,
  groupEventsByDay,
  weekBounds,
} from "@/domain/calendar/agenda";
import { formatDayHeading } from "@/domain/calendar/format";
import { useOffline } from "@/offline/provider";

import { type AgendaEvent, EventCard } from "./event-card";

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

  return (
    <div>
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
            <DayColumn day={day} locale={locale} timeZone={timeZone} />
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
}: {
  day: AgendaDay<AgendaEvent>;
  timeZone: string;
  locale: string;
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
              <EventCard event={event} locale={locale} timeZone={timeZone} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
