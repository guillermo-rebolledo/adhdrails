import {
  type ConnectionResponse,
  connectionResponseSchema,
} from "@/domain/calendar/connection";
import { validationProblem } from "@/server/http/problem";

import type { SaveSelectionResult } from "./service";

/** Validates the connection view against its shared contract before responding. */
export function serializeConnection(
  connection: ConnectionResponse,
): ConnectionResponse {
  return connectionResponseSchema.parse(connection);
}

const SELECTION_MESSAGES: Record<string, string> = {
  unknown_calendar: "One of the calendars is no longer available.",
  multiple_writable: "Choose a single calendar for new events.",
  readonly_writable:
    "A read-only calendar cannot be used for new events. Choose a calendar you own or can edit.",
};

/**
 * Maps a failed save-selection outcome to a Problem Details response. Shape
 * errors surface their field errors; a domain rule violation surfaces a calm,
 * human-safe message under the `selections` field. `not_connected` is mapped by
 * the route to a 404 since it is a resource-state, not a validation, problem.
 */
export function saveSelectionFailureResponse(
  result: Extract<
    SaveSelectionResult,
    { ok: false; reason: "invalid_shape" | "invalid" }
  >,
  correlationId: string,
): Response {
  if (result.reason === "invalid_shape") {
    return validationProblem(correlationId, result.fieldErrors);
  }

  return validationProblem(correlationId, {
    selections: [
      SELECTION_MESSAGES[result.validation.reason] ??
        "This calendar selection is not allowed.",
    ],
  });
}
