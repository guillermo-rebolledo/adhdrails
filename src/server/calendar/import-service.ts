import { mapGoogleEvent, mirrorWindow } from "@/domain/calendar/import";
import type { EventRepository } from "@/server/event/repository";

import {
  GoogleGoneError,
  type GoogleCalendarAuthAdapter,
} from "./google-adapter";
import type { CalendarRepository } from "./repository";
import type { TokenCipher } from "./token-cipher";

export interface CalendarImportDependencies {
  calendarRepository: CalendarRepository;
  eventRepository: EventRepository;
  adapter: GoogleCalendarAuthAdapter;
  cipher: TokenCipher;
  /** Injectable clock so the window and last-synced instant are deterministic. */
  now?: () => Date;
}

export type ImportResult =
  | {
      ok: true;
      imported: number;
      removed: number;
      lastSyncedAt: string;
    }
  | { ok: false; reason: "not_connected" }
  | { ok: false; reason: "unauthorized" };

/**
 * Owns the bounded initial import of Google Calendar events into the
 * account-scoped mirror (MEM-40). For each visible calendar it refreshes an
 * access token from the stored refresh token, pages `events.list` over the
 * default 30-days-past/12-months-future window, upserts each mappable event by
 * its account-scoped provider identity (so re-delivery never duplicates), and
 * removes any event Google reports cancelled. It records each calendar's sync
 * cursor and last-synchronized instant, setting up the incremental sync
 * (MEM-41). Google stays authoritative; local Rails Events are never touched.
 */
export function createCalendarImportService(deps: CalendarImportDependencies) {
  const {
    calendarRepository,
    eventRepository,
    adapter,
    cipher,
    now = () => new Date(),
  } = deps;

  return {
    async importMirror(userId: string): Promise<ImportResult> {
      const connection = await calendarRepository.getConnection(userId);
      if (!connection) {
        return { ok: false, reason: "not_connected" };
      }

      let accessToken: string;
      try {
        const refreshToken = cipher.decrypt(connection.encryptedRefreshToken);
        const token = await adapter.refreshAccessToken({ refreshToken });
        accessToken = token.accessToken;
      } catch {
        // The stored grant can no longer mint an access token; the connection
        // needs re-authorization. Login and the existing mirror are untouched.
        return { ok: false, reason: "unauthorized" };
      }

      const calendars = (await calendarRepository.listCalendars(userId)).filter(
        (calendar) => calendar.isVisible,
      );

      const syncedAt = now();
      const window = mirrorWindow(syncedAt.toISOString());
      let imported = 0;
      let removed = 0;

      for (const calendar of calendars) {
        let pageToken: string | undefined;
        let syncToken: string | null = null;

        try {
          do {
            const page = await adapter.listEvents({
              accessToken,
              calendarId: calendar.googleCalendarId,
              timeMin: window.timeMin,
              timeMax: window.timeMax,
              pageToken,
            });

            for (const resource of page.events) {
              const mapped = mapGoogleEvent(resource, {
                googleCalendarId: calendar.googleCalendarId,
                defaultTimeZone: calendar.timeZone,
              });
              if (mapped.kind === "event") {
                await eventRepository.upsertMirror(userId, mapped.event);
                imported += 1;
              } else if (mapped.kind === "cancelled") {
                await eventRepository.removeMirror(
                  userId,
                  calendar.googleCalendarId,
                  mapped.googleEventId,
                );
                removed += 1;
              }
            }

            pageToken = page.nextPageToken ?? undefined;
            syncToken = page.nextSyncToken ?? syncToken;
          } while (pageToken);
        } catch (error) {
          if (!(error instanceof GoogleGoneError)) {
            throw error;
          }
          // A 410 is not expected on this initial windowed import (it sends
          // timeMin/timeMax, never a sync token). Should one occur, skip this
          // calendar's cursor and move on rather than abort the whole import;
          // full 410 recovery — clearing the affected mirror and running a
          // bounded resync — belongs to the incremental sync (MEM-41).
          syncToken = null;
        }

        await calendarRepository.recordCalendarSync(
          userId,
          calendar.googleCalendarId,
          { syncToken, lastSyncedAt: syncedAt },
        );
      }

      return {
        ok: true,
        imported,
        removed,
        lastSyncedAt: syncedAt.toISOString(),
      };
    },
  };
}

export type CalendarImportService = ReturnType<
  typeof createCalendarImportService
>;
