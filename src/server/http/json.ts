import { CORRELATION_ID_HEADER } from "@/server/observability/correlation-id";

/**
 * Parses a JSON request body, returning `undefined` for an empty or malformed
 * payload so a caller can hand it straight to a Zod-validating service rather
 * than throwing on bad input.
 */
export async function readJsonPayload(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * A successful JSON response carrying the request's correlation id and the
 * project's no-store cache policy. Shared by every feature so response-header
 * policy lives in one place.
 */
export function jsonResponse(
  body: unknown,
  correlationId: string,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      [CORRELATION_ID_HEADER]: correlationId,
      "cache-control": "no-store",
    },
  });
}
