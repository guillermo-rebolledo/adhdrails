import { describe, expect, it, vi } from "vitest";

import type {
  CalendarWebhookService,
  WebhookOutcome,
} from "@/server/calendar/webhook-service";

import { createInMemoryRateLimiter } from "@/server/rate-limit/limiter";

import { createCalendarWebhookRouteHandlers } from "./route";

function post(headers: Record<string, string> = {}): Request {
  return new Request("https://rails.example/api/calendar/webhook", {
    method: "POST",
    headers,
  });
}

function handlers(
  outcome: WebhookOutcome,
  handleNotification = vi.fn(),
  rateLimiter = createInMemoryRateLimiter(),
) {
  handleNotification.mockResolvedValue(outcome);
  const service = { handleNotification } as unknown as CalendarWebhookService;
  const { POST } = createCalendarWebhookRouteHandlers({
    getService: () => service,
    createCorrelationId: () => "cor_1",
    rateLimiter,
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

  it("rejects a flood from one client IP with 429 and a Retry-After header", async () => {
    const handleNotification = vi.fn();
    const rateLimiter = createInMemoryRateLimiter();
    const { POST } = handlers(
      { kind: "handshake" },
      handleNotification,
      rateLimiter,
    );
    // Keyed on the forwarded IP, not the spoofable channel id header.
    const flood = post({
      "x-forwarded-for": "198.51.100.9",
      "X-Goog-Channel-ID": "chan-noisy",
    });

    // The rule allows 60/minute; the 61st within the window is throttled.
    let last: Response | undefined;
    for (let i = 0; i < 61; i += 1) {
      last = await POST(flood);
    }

    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toBeTruthy();
    // The throttled request never reached the service.
    expect(handleNotification).toHaveBeenCalledTimes(60);
  });

  it("cannot be bypassed by rotating the channel-id header", async () => {
    const handleNotification = vi.fn();
    const rateLimiter = createInMemoryRateLimiter();
    const { POST } = handlers(
      { kind: "handshake" },
      handleNotification,
      rateLimiter,
    );

    // Same IP, a fresh channel id every request: the window must still exhaust.
    let last: Response | undefined;
    for (let i = 0; i < 61; i += 1) {
      last = await POST(
        post({
          "x-forwarded-for": "198.51.100.9",
          "X-Goog-Channel-ID": `chan-${i}`,
        }),
      );
    }

    expect(last?.status).toBe(429);
    expect(handleNotification).toHaveBeenCalledTimes(60);
  });
});
