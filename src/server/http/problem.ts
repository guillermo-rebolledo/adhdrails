import { CORRELATION_ID_HEADER } from "@/server/observability/correlation-id";

export type ProblemCode =
  | "database_unavailable"
  | "route_not_found"
  | "unauthorized"
  | "validation_failed"
  | "not_found";

export interface ProblemDetails {
  type: `https://rails.app/problems/${string}`;
  title: string;
  status: number;
  code: ProblemCode;
  detail: string;
  correlationId: string;
  retryable: boolean;
  fieldErrors?: Record<string, string[]>;
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
