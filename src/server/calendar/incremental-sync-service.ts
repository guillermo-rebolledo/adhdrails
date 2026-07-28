import {
  expandedMirrorWindow,
  mapGoogleEvent,
  mirrorWindow,
} from "@/domain/calendar/import";
import type { EventRepository } from "@/server/event/repository";

import {
  GoogleGoneError,
  type GoogleCalendarAuthAdapter,
  type GoogleEventsPage,
} from "./google-adapter";
import type { CalendarRepository, CalendarSyncRecord } from "./repository";
import type { TokenCipher } from "./token-cipher";

export interface IncrementalSyncDependencies {
  calendarRepository: CalendarRepository;
  eventRepository: EventRepository;
  adapter: GoogleCalendarAuthAdapter;
  cipher: TokenCipher;
  /** Injectable clock so the sync window and last-synced instant are deterministic. */
  now?: () => Date;
}

export type IncrementalSyncResult =
  | {
      ok: true;
      changed: number;
      removed: number;
      /** True when a `410 Gone` forced a bounded full resynchronization. */
      recovered: boolean;
      lastSyncedAt: string;
    }
  | { ok: false; reason: "not_connected" }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "calendar_not_found" };

/**
 * The outcome of an on-demand range expansion (MEM-43). Additive only — it never
 * advances the cursor or the last-synced instant — so its result is just the
 * counts, plus the same terminal reasons {@link IncrementalSyncResult} carries.
 */
export type ExpandWindowResult =
  | { ok: true; changed: number; removed: number }
  | { ok: false; reason: "not_connected" }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "calendar_not_found" };

interface PageOutcome {
  changed: number;
  removed: number;
  syncToken: string | null;
}

/**
 * Owns the durable incremental synchronization of one Google calendar into the
 * account-scoped mirror (MEM-41). Invoked by the Inngest function a verified
 * webhook enqueues — never inline on the webhook. It refreshes an access token,
 * resumes from the calendar's stored sync cursor to page only the changes since
 * the last sync, and upserts or removes each mirror row by its account-scoped
 * provider identity so re-delivery and retries never duplicate. A `410 Gone`
 * (the sync horizon expired) clears just this calendar's cursor and mirror and
 * runs a bounded full resynchronization over the default window. A calendar with
 * no cursor yet is brought current the same bounded way. Google stays
 * authoritative; local Rails Events are never touched.
 */
export function createIncrementalSyncService(
  deps: IncrementalSyncDependencies,
) {
  const {
    calendarRepository,
    eventRepository,
    adapter,
    cipher,
    now = () => new Date(),
  } = deps;

  /** Upserts or removes each mapped resource in a page, returning the counts. */
  async function applyEvents(
    userId: string,
    calendar: CalendarSyncRecord,
    resources: Awaited<
      ReturnType<GoogleCalendarAuthAdapter["listEventChanges"]>
    >["events"],
  ): Promise<{ changed: number; removed: number }> {
    let changed = 0;
    let removed = 0;
    for (const resource of resources) {
      const mapped = mapGoogleEvent(resource, {
        googleCalendarId: calendar.googleCalendarId,
        defaultTimeZone: calendar.timeZone,
      });
      if (mapped.kind === "event") {
        await eventRepository.upsertMirror(userId, mapped.event);
        changed += 1;
      } else if (mapped.kind === "cancelled") {
        await eventRepository.removeMirror(
          userId,
          calendar.googleCalendarId,
          mapped.googleEventId,
        );
        removed += 1;
      }
    }
    return { changed, removed };
  }

  /**
   * Drives one paginated read to exhaustion, applying every page as it arrives
   * and capturing the final `nextSyncToken`. `fetchPage` is the only difference
   * between resuming from a cursor and reading the bounded window, so both share
   * this loop.
   */
  async function pageThrough(
    userId: string,
    calendar: CalendarSyncRecord,
    fetchPage: (pageToken?: string) => Promise<GoogleEventsPage>,
  ): Promise<PageOutcome> {
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;
    let changed = 0;
    let removed = 0;

    do {
      const page = await fetchPage(pageToken);
      const applied = await applyEvents(userId, calendar, page.events);
      changed += applied.changed;
      removed += applied.removed;
      pageToken = page.nextPageToken ?? undefined;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);

    return { changed, removed, syncToken: nextSyncToken };
  }

  /** Pages the changes since a stored cursor. */
  function syncFromCursor(
    userId: string,
    calendar: CalendarSyncRecord,
    accessToken: string,
    syncToken: string,
  ): Promise<PageOutcome> {
    return pageThrough(userId, calendar, (pageToken) =>
      adapter.listEventChanges({
        accessToken,
        calendarId: calendar.googleCalendarId,
        syncToken,
        pageToken,
      }),
    );
  }

  /**
   * A bounded full resynchronization over the default mirror window, used the
   * first time a calendar syncs and after a `410 Gone`. Pages `events.list` with
   * `timeMin`/`timeMax` (never a stale cursor) and captures a fresh cursor.
   */
  function resyncWindow(
    userId: string,
    calendar: CalendarSyncRecord,
    accessToken: string,
    at: Date,
  ): Promise<PageOutcome> {
    const window = mirrorWindow(at.toISOString());
    return pageThrough(userId, calendar, (pageToken) =>
      adapter.listEvents({
        accessToken,
        calendarId: calendar.googleCalendarId,
        timeMin: window.timeMin,
        timeMax: window.timeMax,
        pageToken,
      }),
    );
  }

  return {
    async syncCalendar(
      userId: string,
      googleCalendarId: string,
    ): Promise<IncrementalSyncResult> {
      const connection = await calendarRepository.getConnection(userId);
      if (!connection) {
        return { ok: false, reason: "not_connected" };
      }

      const calendar = await calendarRepository.getCalendar(
        userId,
        googleCalendarId,
      );
      if (!calendar || !calendar.isVisible) {
        // Nothing to sync: the calendar was removed or hidden since the watch was
        // opened. Not an error — the webhook already acknowledged.
        return { ok: false, reason: "calendar_not_found" };
      }

      let accessToken: string;
      try {
        const refreshToken = cipher.decrypt(connection.encryptedRefreshToken);
        const token = await adapter.refreshAccessToken({ refreshToken });
        accessToken = token.accessToken;
      } catch {
        return { ok: false, reason: "unauthorized" };
      }

      const syncedAt = now();
      let outcome: PageOutcome;
      let recovered = false;

      if (!calendar.syncToken) {
        // No cursor yet (never imported, or cleared): establish one from a
        // bounded window read rather than a change read Google would reject.
        outcome = await resyncWindow(userId, calendar, accessToken, syncedAt);
      } else {
        try {
          outcome = await syncFromCursor(
            userId,
            calendar,
            accessToken,
            calendar.syncToken,
          );
        } catch (error) {
          if (!(error instanceof GoogleGoneError)) {
            throw error;
          }
          // The sync horizon expired: clear only this calendar's cursor and
          // mirror, then rebuild it from a bounded window read.
          recovered = true;
          await calendarRepository.recordCalendarSync(
            userId,
            googleCalendarId,
            {
              syncToken: null,
              lastSyncedAt: syncedAt,
            },
          );
          await eventRepository.removeMirrorForCalendar(
            userId,
            googleCalendarId,
          );
          outcome = await resyncWindow(userId, calendar, accessToken, syncedAt);
        }
      }

      await calendarRepository.recordCalendarSync(userId, googleCalendarId, {
        // Keep the prior cursor if a page carried none (null or empty), so the
        // next sync still resumes rather than silently doing a full window read.
        // After a 410 the prior cursor is the expired one that caused it, so the
        // recovery path must never restore it — fall back to null instead.
        syncToken: outcome.syncToken || (recovered ? null : calendar.syncToken),
        lastSyncedAt: syncedAt,
      });

      return {
        ok: true,
        changed: outcome.changed,
        removed: outcome.removed,
        recovered,
        lastSyncedAt: syncedAt.toISOString(),
      };
    },

    /**
     * On-demand range expansion (MEM-43): brings the mirror current over the
     * default window stretched forward to `throughIso`, for when the user browses
     * past the default 12-month horizon. It pages a bounded window read and
     * upserts by provider identity, so it only ever adds or refreshes rows —
     * current agenda data is never dropped. It deliberately leaves the incremental
     * cursor and last-synced instant untouched: expansion is additive coverage,
     * not a checkpoint, so ordinary incremental sync keeps resuming from where it
     * left off.
     */
    async expandWindow(
      userId: string,
      googleCalendarId: string,
      throughIso: string,
    ): Promise<ExpandWindowResult> {
      const connection = await calendarRepository.getConnection(userId);
      if (!connection) {
        return { ok: false, reason: "not_connected" };
      }

      const calendar = await calendarRepository.getCalendar(
        userId,
        googleCalendarId,
      );
      if (!calendar || !calendar.isVisible) {
        return { ok: false, reason: "calendar_not_found" };
      }

      let accessToken: string;
      try {
        const refreshToken = cipher.decrypt(connection.encryptedRefreshToken);
        const token = await adapter.refreshAccessToken({ refreshToken });
        accessToken = token.accessToken;
      } catch {
        return { ok: false, reason: "unauthorized" };
      }

      const window = expandedMirrorWindow(now().toISOString(), throughIso);
      const outcome = await pageThrough(userId, calendar, (pageToken) =>
        adapter.listEvents({
          accessToken,
          calendarId: calendar.googleCalendarId,
          timeMin: window.timeMin,
          timeMax: window.timeMax,
          pageToken,
        }),
      );

      return { ok: true, changed: outcome.changed, removed: outcome.removed };
    },
  };
}

export type IncrementalSyncService = ReturnType<
  typeof createIncrementalSyncService
>;
