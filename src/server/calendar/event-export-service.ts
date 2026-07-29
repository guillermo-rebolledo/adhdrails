import {
  buildGoogleEventWrite,
  type ExportableEvent,
} from "@/domain/calendar/export";
import type { EventRepository } from "@/server/event/repository";
import type { ExportJobRecord } from "@/server/event/export-job-repository";

import type { GoogleCalendarAuthAdapter } from "./google-adapter";
import type { CalendarRepository } from "./repository";
import type { TokenCipher } from "./token-cipher";

export interface EventExportDependencies {
  calendarRepository: CalendarRepository;
  eventRepository: EventRepository;
  adapter: GoogleCalendarAuthAdapter;
  cipher: TokenCipher;
}

/**
 * The outcome of pushing one export job to Google:
 * - `created`/`patched`/`deleted` — the write landed on Google.
 * - `skipped` — a terminal no-op with a safe reason: nothing to write (no
 *   writable calendar, the Event was deleted before its export ran, or the Event
 *   form is deferred — all-day or recurring).
 * - `not_connected`/`unauthorized` — terminal failures (the grant is gone or the
 *   account disconnected Calendar); the job is marked failed with a safe code.
 *
 * A transient Google failure is *not* represented here: the adapter throws and
 * the error propagates so the durable runner retries the whole job.
 */
export type EventExportResult =
  | { ok: true; outcome: "created" | "patched" | "deleted" }
  | { ok: true; outcome: "skipped"; reason: string }
  | { ok: false; reason: "not_connected" | "unauthorized" };

/**
 * Pushes one Event mutation to Google (MEM-42) — the outbound counterpart to the
 * incremental import. It refreshes an access token from the account's stored
 * grant, then creates, patches, or deletes the Event on the writable calendar.
 * A freshly created Event's Google id is written back onto the local row so the
 * mirror sync recognizes it by provider identity and never imports a duplicate,
 * which also makes a retried export idempotent: a second run patches the existing
 * Google Event instead of inserting a second one. Google stays authoritative —
 * this never resolves a conflict in Rails' favor beyond delivering the user's
 * explicit intent; the mirror sync overwrites the local row if Google diverges.
 */
export function createEventExportService(deps: EventExportDependencies) {
  const { calendarRepository, eventRepository, adapter, cipher } = deps;

  return {
    async exportEvent(job: ExportJobRecord): Promise<EventExportResult> {
      const connection = await calendarRepository.getConnection(job.userId);
      if (!connection) {
        // The account disconnected Calendar; there is nowhere to write.
        return { ok: false, reason: "not_connected" };
      }

      let accessToken: string;
      try {
        const refreshToken = cipher.decrypt(connection.encryptedRefreshToken);
        const token = await adapter.refreshAccessToken({ refreshToken });
        accessToken = token.accessToken;
      } catch {
        // The stored grant can no longer refresh — revoked or expired.
        return { ok: false, reason: "unauthorized" };
      }

      if (job.operation === "delete") {
        if (!job.googleCalendarId || !job.googleEventId) {
          // The Event was never mirrored to Google; nothing to remove there.
          return { ok: true, outcome: "skipped", reason: "nothing_to_delete" };
        }
        await adapter.deleteEvent({
          accessToken,
          calendarId: job.googleCalendarId,
          googleEventId: job.googleEventId,
        });
        return { ok: true, outcome: "deleted" };
      }

      const event = await eventRepository.getById(job.userId, job.eventId);
      if (!event) {
        // Deleted before its export ran; a delete job (enqueued at deletion if it
        // was mirrored) handles Google, so this upsert is a terminal no-op.
        return { ok: true, outcome: "skipped", reason: "event_absent" };
      }

      const exportable: ExportableEvent = {
        title: event.title,
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
        startTimeZone: event.startTimeZone,
        endTimeZone: event.endTimeZone,
        isAllDay: event.isAllDay,
        recurringEventId: event.recurringEventId,
        recurrence: event.recurrence,
      };
      const built = buildGoogleEventWrite(exportable);
      if (!built.ok) {
        // All-day and recurring forms are deferred; leave them for Google.
        return { ok: true, outcome: "skipped", reason: built.reason };
      }

      // Patch its own mirror calendar if already linked; otherwise create it on
      // the writable calendar the enqueue captured.
      const calendarId = event.googleCalendarId ?? job.googleCalendarId;
      if (!calendarId) {
        return {
          ok: true,
          outcome: "skipped",
          reason: "no_writable_calendar",
        };
      }

      if (event.googleEventId) {
        await adapter.patchEvent({
          accessToken,
          calendarId,
          googleEventId: event.googleEventId,
          body: built.body,
        });
        return { ok: true, outcome: "patched" };
      }

      const { googleEventId } = await adapter.insertEvent({
        accessToken,
        calendarId,
        body: built.body,
      });
      await eventRepository.linkGoogleIdentity(job.userId, event.id, {
        googleCalendarId: calendarId,
        googleEventId,
      });
      return { ok: true, outcome: "created" };
    },
  };
}

export type EventExportService = ReturnType<typeof createEventExportService>;
