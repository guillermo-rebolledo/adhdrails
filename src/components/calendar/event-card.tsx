import { formatTimeRange } from "@/domain/calendar/format";
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
  origin: EventOrigin;
  status: EventStatus;
  syncState: SyncState;
}

/**
 * One Event as it appears in the agenda or Later list: its locale-aware time
 * range, title, and a quiet synchronization cue. Times are rendered in the
 * Event's own start time zone so an imported commitment keeps its original
 * wall-clock meaning. A `tentative` Event (a timed capture awaiting type
 * confirmation) is rendered in a lighter emphasis.
 */
export function EventCard({
  event,
  timeZone,
  locale,
  stale,
}: {
  event: AgendaEvent;
  /** The viewing time zone; the Event's own zone still governs its clock time. */
  timeZone: string;
  locale: string;
  stale?: boolean;
}) {
  const range = formatTimeRange(
    event.startAt,
    event.endAt,
    event.startTimeZone,
    locale,
  );
  const zoneNote =
    event.startTimeZone !== timeZone ? ` (${event.startTimeZone})` : "";

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
        {zoneNote}
      </span>
    </div>
  );
}
