import { describe, expect, it, vi } from "vitest";

import type {
  CalendarWebhookService,
  WebhookOutcome,
} from "@/server/calendar/webhook-service";

import { createCalendarWebhookRouteHandlers } from "./route";

function post(headers: Record<string, string> = {}): Request {
  return new Request("https://rails.example/api/calendar/webhook", {
    method: "POST",
    headers,
  });
}

function handlers(outcome: WebhookOutcome, handleNotification = vi.fn()) {
  handleNotification.mockResolvedValue(outcome);
  const service = { handleNotification } as unknown as CalendarWebhookService;
  const { POST } = createCalendarWebhookRouteHandlers({
    getService: () => service,
    createCorrelationId: () => "cor_1",
  });
  return { POST, handleNotification };
}

describe("POST /api/calendar/webhook", () => {
  it("extracts the Google notification headers case-insensitively", async () => {
    const { POST, handleNotification } = handlers({ kind: "handshake" });

    await POST(
      post({
        "X-Goog-Channel-ID": "chan-1",
        "X-Goog-Channel-Token": "tok-1",
        "X-Goog-Resource-ID": "res-1",
        "X-Goog-Resource-State": "exists",
        "X-Goog-Message-Number": "5",
      }),
    );

    expect(handleNotification).toHaveBeenCalledWith({
      channelId: "chan-1",
      token: "tok-1",
      resourceId: "res-1",
      resourceState: "exists",
      messageNumber: "5",
    });
  });

  it("acknowledges a handshake with 200", async () => {
    const { POST } = handlers({ kind: "handshake" });
    expect((await POST(post())).status).toBe(200);
  });

  it("acknowledges an accepted change with 200", async () => {
    const { POST } = handlers({
      kind: "accepted",
      enqueued: true,
      jobId: "j1",
    });
    expect((await POST(post())).status).toBe(200);
  });

  it("acknowledges a malformed or ignored notification with 200", async () => {
    expect(
      (await handlers({ kind: "invalid", reason: "bad" }).POST(post())).status,
    ).toBe(200);
    expect(
      (await handlers({ kind: "ignored", reason: "x" }).POST(post())).status,
    ).toBe(200);
  });

  it("tells Google to stop an unverifiable channel with 404", async () => {
    const { POST } = handlers({ kind: "unverified" });
    expect((await POST(post())).status).toBe(404);
  });
});
