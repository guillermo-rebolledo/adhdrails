import pino, { type DestinationStream, type LoggerOptions } from "pino";

/**
 * Paths pino censors before anything is written. Structured logs are the MVP's
 * primary diagnostic surface (Vercel Observability/OpenTelemetry and Inngest run
 * history read them, and Sentry is deferred), so redaction is enforced here once
 * rather than trusted to every call site. User-authored content, identifiers,
 * secrets, and tokens are replaced with a marker even if a caller passes them by
 * mistake.
 */
export const OPERATIONAL_LOG_REDACT_PATHS = [
  "*.authorization",
  "*.body",
  "*.cookie",
  "*.content",
  "*.databaseUrl",
  "*.description",
  "*.email",
  "*.endpoint",
  "*.notes",
  "*.payload",
  "*.query",
  "*.refreshToken",
  "*.title",
  "*.token",
  "*.url",
] as const;

export const OPERATIONAL_LOG_BASE = {
  service: "rails-web",
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
} as const;

/**
 * Builds a structured JSON logger with Rails' redaction policy applied. The
 * optional destination lets a test capture output; production uses pino's
 * default stdout stream, which Vercel Observability collects.
 */
export function createOperationalLogger(
  destination?: DestinationStream,
  options: LoggerOptions = {},
) {
  const config: LoggerOptions = {
    base: OPERATIONAL_LOG_BASE,
    redact: { paths: [...OPERATIONAL_LOG_REDACT_PATHS], censor: "[Redacted]" },
    ...options,
  };
  return destination ? pino(config, destination) : pino(config);
}

const logger = createOperationalLogger();

export interface OperationalLog {
  /** Ties the log line to the request or run that produced it. */
  correlationId: string;
  /** The durable job this line belongs to, when one exists. */
  jobId?: string;
  action: string;
  outcome: "success" | "failure";
  safeCode?: string;
  durationMs?: number;
}

/**
 * Emits one structured, redacted operational log line. Every line carries the
 * correlation id — and the job id when present — so a request can be traced from
 * the API through the outbox, Inngest, Calendar sync, export, and deletion work.
 */
export function logOperationalEvent(event: OperationalLog): void {
  logger.info(event, event.action);
}
