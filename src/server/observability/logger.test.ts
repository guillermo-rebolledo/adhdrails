import { describe, expect, it } from "vitest";

import { createOperationalLogger } from "./logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write(chunk: string) {
      lines.push(JSON.parse(chunk));
    },
  };
  return { stream, lines };
}

describe("operational logger", () => {
  it("carries the correlation id and job id on every line", () => {
    const { stream, lines } = capture();
    const logger = createOperationalLogger(stream);

    logger.info(
      {
        correlationId: "cor_1",
        jobId: "job_9",
        action: "calendar.incremental_synced",
        outcome: "success",
      },
      "calendar.incremental_synced",
    );

    expect(lines[0]).toMatchObject({
      correlationId: "cor_1",
      jobId: "job_9",
      action: "calendar.incremental_synced",
      outcome: "success",
      service: "rails-web",
    });
  });

  it("redacts user content, identifiers, secrets, and tokens if passed by mistake", () => {
    const { stream, lines } = capture();
    const logger = createOperationalLogger(stream);

    logger.info({
      correlationId: "cor_1",
      job: {
        title: "Call the pharmacy",
        notes: "private note",
        content: "sensitive thought",
        email: "person@example.com",
        token: "secret-token",
        refreshToken: "refresh-secret",
        url: "https://calendar.google.com/event/xyz",
        query: "therapist near me",
        payload: "{...}",
      },
    });

    const logged = lines[0].job as Record<string, string>;
    for (const key of Object.keys(logged)) {
      expect(logged[key]).toBe("[Redacted]");
    }
  });
});
