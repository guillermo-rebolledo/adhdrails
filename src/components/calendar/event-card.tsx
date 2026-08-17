import { formatEventTimes } from "@/domain/calendar/format";
import type { EventOrigin, EventStatus } from "@/domain/event/event";
import type { SyncState } from "@/offline/db";

import { SyncBadge } from "./sync-badge";

export interface AgendaEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  startTimeZone: string;
  endTimeZone: string;
  isAllDay: boolean;
  origin: EventOrigin;
  status: EventStatus;
  syncState: SyncState;
}

/**
 * One Event as it appears in the Later list: its locale-aware time range,
 * title, and a quiet synchronization cue. Times are rendered in the account's
 * time zone, matching the weekly agenda, with the original wall-clock start
 * noted when the Event was authored elsewhere. A `tentative` Event (a timed
 * capture awaiting type confirmation) is rendered in a lighter emphasis.
 */
export function EventCard({
  event,
  timeZone,
  locale,
  stale,
}: {
  event: AgendaEvent;
  /** The account's time zone; the Event's clock time is rendered in it. */
  timeZone: string;
  locale: string;
  stale?: boolean;
}) {
  const { range, original } = formatEventTimes({
    startAt: event.startAt,
    endAt: event.endAt,
    timeZone: event.startTimeZone,
    viewingTimeZone: timeZone,
    locale,
    isAllDay: event.isAllDay,
  });

  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-card-foreground">
      <div className="flex items-start justify-between gap-2">
        <span
          className={
            event.status === "tentative"
              ? "min-w-0 truncate font-medium text-muted-foreground"
              : "min-w-0 truncate font-medium"
          }
        >
          {event.title}
        </span>
        <SyncBadge
          origin={event.origin}
          stale={stale}
          syncState={event.syncState}
        />
      </div>
      <span className="text-sm text-muted-foreground">
        {range}
        {original ? ` (${original})` : ""}
      </span>
    </div>
  );
}
