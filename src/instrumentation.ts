import { registerOTel } from "@vercel/otel";

import { assertPreviewIsolation } from "@/server/release/environment";

/**
 * OpenTelemetry registration (MEM-50). Rails' MVP diagnostics are Vercel
 * Observability/OpenTelemetry plus Inngest run history — Sentry is deferred.
 * `@vercel/otel` wires the Next.js runtime's spans (route handlers, fetches,
 * durable work) to Vercel's collector with zero exporter configuration, so
 * server-side traces are available in production alongside the structured,
 * redacted JSON logs. Spans carry no user content; correlation and job ids on
 * the log lines tie a request to its trace.
 *
 * The boot also fails closed if a Preview deployment is somehow carrying
 * production configuration (MEM-52): previews must never receive production
 * access, so an env-scope leak crashes the deployment instead of exposing
 * production data on a throwaway preview URL.
 */
export function register() {
  assertPreviewIsolation();
  registerOTel({ serviceName: "rails-web" });
}
