import { problemResponse } from "@/server/http/problem";
import { correlationIdFrom } from "@/server/observability/correlation-id";

export function createUnknownApiRouteHandler(
  createCorrelationId: (request: Request) => string,
) {
  return function unknownApiRoute(request: Request): Response {
    const correlationId = createCorrelationId(request);

    return problemResponse({
      type: "https://rails.app/problems/not-found",
      title: "Not found",
      status: 404,
      code: "route_not_found",
      detail: "The requested API route does not exist.",
      correlationId,
      retryable: false,
    });
  };
}

const handler = createUnknownApiRouteHandler(correlationIdFrom);

export {
  handler as DELETE,
  handler as GET,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
