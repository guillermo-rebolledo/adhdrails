"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { groupEventsByMonth } from "@/domain/calendar/later";
import { formatMonthHeading } from "@/domain/calendar/format";
import type { EventResponse } from "@/domain/event/event";
import { apiRequest } from "@/lib/api-client";

import { type AgendaEvent, EventCard } from "./event-card";

interface LaterPageResponse {
  items: EventResponse[];
  nextCursor: string | null;
}

async function fetchLaterPage(
  from: string,
  cursor: string | null,
): Promise<LaterPageResponse> {
  const params = new URLSearchParams({ from });
  if (cursor) {
    params.set("cursor", cursor);
  }
  const response = await apiRequest<LaterPageResponse>(
    `/api/v1/events/later?${params.toString()}`,
  );
  if (!response.ok || !response.body) {
    throw new Error("Could not load later events.");
  }
  return response.body;
}

/**
 * The Later list: Events scheduled beyond the current agenda week. It is a
 * server-owned, cursor-paginated view managed by TanStack Query's
 * `useInfiniteQuery` — the one place Rails reads Events from the server rather
 * than the optimistic Dexie replica, so the two never double-own the same
 * state. Results are grouped by month with a stable "Load more". While the
 * query revalidates, its Events are marked as refreshing so old data is never
 * mistaken for current data.
 */
export function LaterList({
  from,
  timeZone,
  locale,
}: {
  /** The instant just past the current week (the Later window start). */
  from: string;
  timeZone: string;
  locale: string;
}) {
  const query = useInfiniteQuery({
    queryKey: ["events", "later", from],
    queryFn: ({ pageParam }) => fetchLaterPage(from, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  if (query.status === "pending") {
    return (
      <p className="text-sm text-muted-foreground">Loading later events…</p>
    );
  }

  if (query.status === "error") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Later events are unavailable right now. They&apos;ll return when the
        connection does.
      </p>
    );
  }

  // Server-owned Events are authoritative, so each maps to a `synced` agenda
  // card; its `origin` still distinguishes a Google mirror from a local Event.
  const items: AgendaEvent[] = query.data.pages
    .flatMap((page) => page.items)
    .map((event) => ({
      id: event.id,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      startTimeZone: event.startTimeZone,
      endTimeZone: event.endTimeZone,
      origin: event.origin,
      status: event.status,
      syncState: "synced",
    }));
  // A background refetch means the mirror may be momentarily out of date.
  const stale = query.isFetching && !query.isFetchingNextPage;

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing scheduled beyond this week yet.
      </p>
    );
  }

  const months = groupEventsByMonth(items, timeZone);

  return (
    <div className="flex flex-col gap-6">
      {months.map((group) => (
        <section
          aria-label={formatMonthHeading(group.month, locale)}
          key={group.month}
        >
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            {formatMonthHeading(group.month, locale)}
          </h3>
          <ul className="flex flex-col gap-2">
            {group.events.map((event) => (
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
        </section>
      ))}

      {query.hasNextPage ? (
        <button
          className="self-start rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          type="button"
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}
