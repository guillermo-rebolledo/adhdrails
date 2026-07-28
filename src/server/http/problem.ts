import { CORRELATION_ID_HEADER } from "@/server/observability/correlation-id";

export type ProblemCode =
  | "database_unavailable"
  | "route_not_found"
  | "unauthorized"
  | "validation_failed"
  | "conflict"
  | "not_found"
  | "gone"
  | "push_unavailable"
  | "recurring_series_edit"
  | "calendar_reauth_required";

export interface ProblemDetails {
  type: `https://rails.app/problems/${string}`;
  title: string;
  status: number;
  code: ProblemCode;
  detail: string;
  correlationId: string;
  retryable: boolean;
  fieldErrors?: Record<string, string[]>;
  /**
   * The server's current view of a contested record, returned with a conflict
   * so the client can present it for review instead of discarding local data.
   */
  current?: unknown;
}

export function problemResponse(problem: ProblemDetails): Response {
  return Response.json(problem, {
    status: problem.status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/problem+json",
      [CORRELATION_ID_HEADER]: problem.correlationId,
    },
  });
}

export function unauthorizedProblem(correlationId: string): Response {
  return problemResponse({
    type: "https://rails.app/problems/unauthorized",
    title: "Sign in required",
    status: 401,
    code: "unauthorized",
    detail: "This request requires an authenticated Rails account.",
    correlationId,
    retryable: false,
  });
}

export function validationProblem(
  correlationId: string,
  fieldErrors: Record<string, string[]>,
): Response {
  return problemResponse({
    type: "https://rails.app/problems/validation-failed",
    title: "Invalid request",
    status: 422,
    code: "validation_failed",
    detail: "Some fields need attention before this request can be saved.",
    correlationId,
    retryable: false,
    fieldErrors,
  });
}

export function conflictProblem(
  correlationId: string,
  current: unknown,
): Response {
  return problemResponse({
    type: "https://rails.app/problems/conflict",
    title: "Change conflicts with the server",
    status: 409,
    code: "conflict",
    detail:
      "This record changed since your local copy. Your change was kept for review.",
    correlationId,
    retryable: false,
    current,
  });
}

export function notFoundProblem(
  correlationId: string,
  detail = "The requested record does not exist.",
): Response {
  return problemResponse({
    type: "https://rails.app/problems/not-found",
    title: "Not found",
    status: 404,
    code: "not_found",
    detail,
    correlationId,
    retryable: false,
  });
}

export function pushUnavailableProblem(correlationId: string): Response {
  return problemResponse({
    type: "https://rails.app/problems/push-unavailable",
    title: "Notification could not be sent",
    status: 503,
    code: "push_unavailable",
    detail: "The browser notification service is temporarily unavailable.",
    correlationId,
    retryable: true,
  });
}

/**
 * The record was deliberately deleted and tombstoned. A queued create or update
 * that arrives afterward must not resurrect it; the client drops its local copy.
 */
export function goneProblem(correlationId: string): Response {
  return problemResponse({
    type: "https://rails.app/problems/gone",
    title: "Record was deleted",
    status: 410,
    code: "gone",
    detail: "This record was deleted and cannot be changed.",
    correlationId,
    retryable: false,
  });
}

/**
 * The Event belongs to a recurring series. Rails does not implement recurring
 * edits in the MVP and routes the user to Google Calendar instead, so the edit
 * is refused rather than partially applied. The client keeps its local copy and
 * surfaces a "edit in Google Calendar" affordance.
 */
export function recurringSeriesProblem(correlationId: string): Response {
  return problemResponse({
    type: "https://rails.app/problems/recurring-series-edit",
    title: "Edit recurring events in Google Calendar",
    status: 422,
    code: "recurring_series_edit",
    detail:
      "Recurring events are edited in Google Calendar. Your change was kept for review.",
    correlationId,
    retryable: false,
  });
}

export function accountNotFoundProblem(correlationId: string): Response {
  return problemResponse({
    type: "https://rails.app/problems/account-not-found",
    title: "Account not found",
    status: 404,
    code: "not_found",
    detail: "The signed-in account no longer exists.",
    correlationId,
    retryable: false,
  });
}

/**
 * The account is signed in but Google Calendar can no longer be reached with the
 * stored grant, so it must be reconnected. Distinct from `unauthorized`, which
 * concerns the Rails session itself; login and local data remain intact.
 */
export function calendarReauthProblem(correlationId: string): Response {
  return problemResponse({
    type: "https://rails.app/problems/calendar-reauth-required",
    title: "Reconnect Google Calendar",
    status: 403,
    code: "calendar_reauth_required",
    detail: "Google Calendar access needs to be reconnected.",
    correlationId,
    retryable: false,
  });
}
