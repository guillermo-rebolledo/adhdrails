import { registerOTel } from "@vercel/otel";

/**
 * OpenTelemetry registration (MEM-50). Rails' MVP diagnostics are Vercel
 * Observability/OpenTelemetry plus Inngest run history — Sentry is deferred.
 * `@vercel/otel` wires the Next.js runtime's spans (route handlers, fetches,
 * durable work) to Vercel's collector with zero exporter configuration, so
 * server-side traces are available in production alongside the structured,
 * redacted JSON logs. Spans carry no user content; correlation and job ids on
 * the log lines tie a request to its trace.
 */
export function register() {
  registerOTel({ serviceName: "rails-web" });
}
