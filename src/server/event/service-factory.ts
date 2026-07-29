import { createCalendarRepository } from "@/server/calendar/repository";
import { getDatabase } from "@/server/db/connection";

import { createEventRepository } from "./repository";
import { createEventService, type EventService } from "./service";

/**
 * Builds the request-time Event service wired for bidirectional write sync
 * (MEM-42): the repository enqueues export jobs atomically with each mutation,
 * and the writable-calendar lookup lets the service decide whether a local Event
 * should be exported to Google. The lookup reads the account's single writable
 * calendar; when there is none, local Events stay local until an explicit
 * export-on-reconnect.
 */
export function getEventService(): EventService {
  const database = getDatabase();
  const calendarRepository = createCalendarRepository(database);
  return createEventService(createEventRepository(database), {
    writableCalendar: {
      get: (userId) => calendarRepository.getWritableCalendar(userId),
    },
  });
}
