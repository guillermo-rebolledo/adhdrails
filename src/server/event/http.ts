import {
  type EventResponse,
  eventOriginSchema,
  eventResponseSchema,
  eventStatusSchema,
} from "@/domain/event/event";
import {
  conflictProblem,
  goneProblem,
  notFoundProblem,
  recurringSeriesProblem,
  validationProblem,
} from "@/server/http/problem";

import type { EventRecord } from "./repository";
import type { EventCreateResult, EventUpdateResult } from "./service";

export function serializeEvent(record: EventRecord): EventResponse {
  return eventResponseSchema.parse({
    id: record.id,
    title: record.title,
    startAt: record.startAt.toISOString(),
    endAt: record.endAt.toISOString(),
    startTimeZone: record.startTimeZone,
    endTimeZone: record.endTimeZone,
    isAllDay: record.isAllDay,
    allDayStartDate: record.allDayStartDate,
    allDayEndDate: record.allDayEndDate,
    recurringEventId: record.recurringEventId,
    recurrence: record.recurrence,
    status: eventStatusSchema.parse(record.status),
    origin: eventOriginSchema.parse(record.origin),
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

/** Maps a failed create outcome to its Problem Details response. */
export function eventCreateFailureResponse(
  result: Extract<EventCreateResult, { ok: false }>,
  correlationId: string,
): Response {
  switch (result.reason) {
    case "invalid":
      return validationProblem(correlationId, result.fieldErrors);
    case "conflict":
      return conflictProblem(correlationId, serializeEvent(result.current));
    case "gone":
      return goneProblem(correlationId);
  }
}

/** Maps a failed update outcome to its Problem Details response. */
export function eventUpdateFailureResponse(
  result: Extract<EventUpdateResult, { ok: false }>,
  correlationId: string,
): Response {
  switch (result.reason) {
    case "invalid":
      return validationProblem(correlationId, result.fieldErrors);
    case "conflict":
      return conflictProblem(correlationId, serializeEvent(result.current));
    case "not_found":
      return notFoundProblem(correlationId, "This event no longer exists.");
    case "gone":
      return goneProblem(correlationId);
    case "recurring_series":
      return recurringSeriesProblem(correlationId);
  }
}
