import { formatEventTimes } from "@/domain/calendar/format";
import { cn } from "@/lib/utils";

import type { AgendaEvent } from "./event-card";
import { SyncBadge } from "./sync-badge";

/**
 * One Event as a row of the weekly agenda: its time range in a fixed leading
 * column, then the title across the whole remaining width, then a quiet
 * synchronization cue. The fixed time column is what lets a week of rows scan
 * vertically — every start time lines up — while the title, the part a user
 * actually reads, is never the thing that gets clipped.
 *
 * The Later list keeps the boxed `EventCard` instead: it groups by month rather
 * than by day, so it has no shared day context for a bare row to sit in.
 *
 * Times are rendered in the account's time zone, so one week reads on one
 * clock; an Event authored elsewhere also shows its original wall-clock start
 * beside the row. A `tentative` Event — a timed capture awaiting type
 * confirmation — is rendered in a lighter emphasis.
 */
export function AgendaRow({
  event,
  timeZone,
  locale,
  stale,
}: {
  event: AgendaEvent;
  /** The account's time zone; every row's clock time is rendered in it. */
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
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border/60 py-2.5 first:pt-0 last:border-b-0 last:pb-0">
      <span className="shrink-0 text-sm text-muted-foreground tabular-nums sm:w-40">
        {range}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 basis-64 leading-snug font-medium",
          event.status === "tentative" && "text-muted-foreground",
        )}
      >
        {event.title}
      </span>
      {original ? (
        <span className="text-xs text-muted-foreground">{original}</span>
      ) : null}
      <SyncBadge
        origin={event.origin}
        stale={stale}
        syncState={event.syncState}
      />
    </li>
  );
}
