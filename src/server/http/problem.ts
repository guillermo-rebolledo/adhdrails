import { CORRELATION_ID_HEADER } from "@/server/observability/correlation-id";

export type ProblemCode = "database_unavailable" | "route_not_found";

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
