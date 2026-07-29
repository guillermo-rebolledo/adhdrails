import type { EventExportJobRepository } from "@/server/event/export-job-repository";
import type { EventRepository } from "@/server/event/repository";

import type { CalendarRepository } from "./repository";

export interface ExportLocalDependencies {
  calendarRepository: CalendarRepository;
  eventRepository: EventRepository;
  exportJobRepository: EventExportJobRepository;
}

export type ExportLocalResult =
  | { ok: true; enqueued: number }
  | { ok: false; reason: "no_writable_calendar" };

/**
 * Backfills the export outbox for Events authored while Calendar was
 * disconnected (MEM-42, user story 93). Exporting local Events is an *explicit*
 * choice made after a writable calendar exists, never automatic on reconnect —
 * so this runs only when the user opts in. It enqueues one `upsert` job per local
 * Event that has no provider identity yet; the durable exporter then creates each
 * on Google and writes its id back. Idempotent: the outbox's `(user, event,
 * operation)` uniqueness re-arms an existing job rather than duplicating it, and
 * an Event already exported (with a provider id) is excluded from the backfill.
 */
export function createExportLocalService(deps: ExportLocalDependencies) {
  const { calendarRepository, eventRepository, exportJobRepository } = deps;

  return {
    async exportLocalEvents(userId: string): Promise<ExportLocalResult> {
      const writable = await calendarRepository.getWritableCalendar(userId);
      if (!writable) {
        return { ok: false, reason: "no_writable_calendar" };
      }

      const events = await eventRepository.listUnexportedLocalEvents(userId);
      for (const event of events) {
        await exportJobRepository.enqueue({
          userId,
          eventId: event.id,
          operation: "upsert",
          googleCalendarId: writable.googleCalendarId,
        });
      }

      return { ok: true, enqueued: events.length };
    },
  };
}

export type ExportLocalService = ReturnType<typeof createExportLocalService>;
