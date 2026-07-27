import pino from "pino";

const logger = pino({
  base: {
    service: "rails-web",
    environment:
      process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  },
  redact: {
    paths: [
      "*.authorization",
      "*.cookie",
      "*.content",
      "*.databaseUrl",
      "*.description",
      "*.email",
      "*.notes",
      "*.refreshToken",
      "*.title",
      "*.token",
    ],
    censor: "[Redacted]",
  },
});

export interface OperationalLog {
  correlationId: string;
  action: string;
  outcome: "success" | "failure";
  safeCode?: string;
  durationMs?: number;
}

export function logOperationalEvent(event: OperationalLog): void {
  logger.info(event, event.action);
}
