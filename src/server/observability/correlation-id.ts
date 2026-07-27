const CORRELATION_ID_HEADER = "x-correlation-id";
const OPAQUE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function correlationIdFrom(request: Request): string {
  const incomingId = request.headers.get(CORRELATION_ID_HEADER);

  return incomingId && OPAQUE_UUID.test(incomingId)
    ? incomingId
    : crypto.randomUUID();
}

export { CORRELATION_ID_HEADER };
