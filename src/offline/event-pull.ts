import { z } from "zod";

import { type EventResponse, eventResponseSchema } from "@/domain/event/event";
import { apiRequest } from "@/lib/api-client";

import type { LocalEvent, RailsDatabase } from "./db";

/**
 * Hydrates the Dexie replica from the server-authoritative Event mirror so the
 * weekly agenda (which reads Dexie via `useLiveQuery`) shows imported Google
 * Events alongside local ones. The Later list stays TanStack-owned; this pull
 * covers only the current week window the agenda renders. It never overwrites a
 * pending local change, and it removes Google mirror rows the server no longer
 * returns in the window so upstream deletions display faithfully.
 */

const eventWindowResponseSchema = z.object({
  items: z.array(eventResponseSchema),
});

/** The half-open instant window `[from, to)` the agenda hydrates. */
export interface EventWindow {
  from: string;
  to: string;
}

/** The outcome of a mirror sync request the agenda can surface to the user. */
export interface MirrorSyncResult {
  imported: number;
  removed: number;
  lastSyncedAt: string;
}

function toLocalEvent(event: EventResponse): LocalEvent {
  return {
    id: event.id,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    startTimeZone: event.startTimeZone,
    endTimeZone: event.endTimeZone,
    isAllDay: event.isAllDay,
    recurringEventId: event.recurringEventId,
    status: event.status,
    origin: event.origin,
    version: event.version,
    createdAt: event.createdAt,
    deletedAt: null,
    syncState: "synced",
  };
}

/**
 * Reconciles a window of server Events into Dexie. A server Event is written
 * only when there is no local row, or the local row is already synced and not
 * mid-deletion — so a pending create, edit, or optimistic deletion is never
 * clobbered. Any Google-origin, synced row inside the window the server did not
 * return is treated as deleted upstream and removed.
 */
export async function reconcileEventWindow(
  db: RailsDatabase,
  items: readonly EventResponse[],
  window: EventWindow,
): Promise<void> {
  const serverIds = new Set(items.map((event) => event.id));

  await db.transaction("rw", db.events, async () => {
    for (const event of items) {
      const local = await db.events.get(event.id);
      // An optimistic deletion stamped locally but not yet synced must survive:
      // overwriting it would resurrect the Event mid-undo.
      if (local?.deletedAt) {
        continue;
      }
      if (
        !local ||
        (local.syncState === "synced" && event.version >= local.version)
      ) {
        await db.events.put(toLocalEvent(event));
      }
    }

    const stale = await db.events
      .where("startAt")
      .between(window.from, window.to, true, false)
      .filter(
        (event) =>
          event.origin === "google" &&
          event.syncState === "synced" &&
          event.deletedAt === null &&
          !serverIds.has(event.id),
      )
      .toArray();
    for (const event of stale) {
      await db.events.delete(event.id);
    }
  });
}

/**
 * Fetches the server Events whose start falls in `[from, to)` and reconciles
 * them into Dexie. Returns the ids for the window (mostly for tests); the agenda
 * renders from the live Dexie query, not this return value.
 */
export async function fetchEventWindow(
  db: RailsDatabase,
  window: EventWindow,
): Promise<string[]> {
  const params = new URLSearchParams({ from: window.from, to: window.to });
  const response = await apiRequest<unknown>(
    `/api/v1/events?${params.toString()}`,
  );
  if (!response.ok || !response.body) {
    throw new Error("Could not load calendar events.");
  }

  const { items } = eventWindowResponseSchema.parse(response.body);
  await reconcileEventWindow(db, items, window);
  return items.map((event) => event.id);
}

/**
 * Asks the server to import the account's calendars from Google into the
 * mirror. Returns the sync result, or null when Calendar is not connected or
 * needs re-authorization — the agenda works fully without Google access, so a
 * missing connection is not an error here.
 */
export async function syncCalendarMirror(): Promise<MirrorSyncResult | null> {
  const response = await apiRequest<MirrorSyncResult>("/api/v1/calendar/sync", {
    method: "POST",
  });
  if (response.ok && response.body) {
    return response.body;
  }
  return null;
}
