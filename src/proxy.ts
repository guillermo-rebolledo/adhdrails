import { NextRequest, NextResponse } from "next/server";

import {
  CORRELATION_ID_HEADER,
  correlationIdFrom,
} from "@/server/observability/correlation-id";

const SECURITY_HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

function createNonce(): string {
  return btoa(crypto.randomUUID());
}

function contentSecurityPolicy(nonce: string): string {
  const developmentScriptSource =
    process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentScriptSource}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // Umami Cloud (US region) content-free analytics: the tracker script is
    // nonce-allowed via `strict-dynamic`, and its Cloud ingest endpoint is the
    // only extra analytics connect target.
    "connect-src 'self' https://*.neon.tech wss://*.neon.tech https://cloud.umami.is",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ];

  if (process.env.VERCEL_ENV) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const correlationId = correlationIdFrom(request);
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(CORRELATION_ID_HEADER, correlationId);
  requestHeaders.set("content-security-policy", policy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("content-security-policy", policy);
  response.headers.set(CORRELATION_ID_HEADER, correlationId);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
    },
  ],
};
