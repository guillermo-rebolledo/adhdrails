import { watchNeedsRenewal } from "@/domain/calendar/notification";

import type { CalendarWebhookConfig } from "./env";
import type { GoogleCalendarAuthAdapter } from "./google-adapter";
import type { CalendarRepository } from "./repository";
import type { TokenCipher } from "./token-cipher";

export interface CalendarWatchDependencies {
  calendarRepository: CalendarRepository;
  adapter: GoogleCalendarAuthAdapter;
  cipher: TokenCipher;
  config: CalendarWebhookConfig;
  /** Injectable clock so renewal decisions are deterministic. */
  now?: () => Date;
  /** Injectable id/token minting so channels are deterministic in tests. */
  newChannelId?: () => string;
  newToken?: () => string;
}

export type EnsureWatchesResult =
  | { ok: true; registered: number; skipped: number }
  | { ok: false; reason: "not_connected" }
  | { ok: false; reason: "unauthorized" };

/**
 * Owns the push-notification watches that make incremental sync event-driven
 * (MEM-41). For each visible calendar it opens a watch — a channel Google posts
 * notifications to — and stores that channel independently: its id (how a
 * notification is routed back), Google's resource id, an opaque verification
 * token (checked before any sync), and the expiry (so the watch is renewed before
 * Google stops delivering). Renewal replaces an expiring channel: the old one is
 * stopped best-effort and a fresh one opened. A calendar with a comfortably
 * future watch is left alone, so re-running this is cheap and idempotent.
 */
export function createCalendarWatchService(deps: CalendarWatchDependencies) {
  const {
    calendarRepository,
    adapter,
    cipher,
    config,
    now = () => new Date(),
    newChannelId = () => crypto.randomUUID(),
    newToken = () => crypto.randomUUID().replace(/-/g, ""),
  } = deps;

  return {
    async ensureWatches(userId: string): Promise<EnsureWatchesResult> {
      const connection = await calendarRepository.getConnection(userId);
      if (!connection) {
        return { ok: false, reason: "not_connected" };
      }

      const calendars =
        await calendarRepository.listVisibleCalendarSyncState(userId);
      const at = now();
      const due = calendars.filter((calendar) =>
        watchNeedsRenewal(calendar.watchExpiresAt, at),
      );

      // This runs on every sync (throttled client-side); when every watch is
      // comfortably fresh there is nothing to do, so skip the token refresh too.
      if (due.length === 0) {
        return { ok: true, registered: 0, skipped: calendars.length };
      }

      let accessToken: string;
      try {
        const refreshToken = cipher.decrypt(connection.encryptedRefreshToken);
        const token = await adapter.refreshAccessToken({ refreshToken });
        accessToken = token.accessToken;
      } catch {
        return { ok: false, reason: "unauthorized" };
      }

      let registered = 0;
      const skipped = calendars.length - due.length;

      for (const calendar of due) {

        // Stop the expiring channel first so Google is not left delivering to two
        // channels for the same calendar. Best-effort: a dead channel is fine.
        if (calendar.watchChannelId && calendar.watchResourceId) {
          await adapter.stopChannel({
            accessToken,
            channelId: calendar.watchChannelId,
            resourceId: calendar.watchResourceId,
          });
        }

        const channelId = newChannelId();
        const watchToken = newToken();
        const channel = await adapter.watchEvents({
          accessToken,
          calendarId: calendar.googleCalendarId,
          channelId,
          token: watchToken,
          address: config.address,
          ttlSeconds: config.ttlSeconds,
        });

        await calendarRepository.saveWatch(userId, calendar.googleCalendarId, {
          channelId: channel.channelId,
          resourceId: channel.resourceId,
          token: watchToken,
          expiresAt: channel.expiration,
        });
        registered += 1;
      }

      return { ok: true, registered, skipped };
    },
  };
}

export type CalendarWatchService = ReturnType<
  typeof createCalendarWatchService
>;
