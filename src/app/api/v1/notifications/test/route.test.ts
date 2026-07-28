import { describe, expect, it, vi } from "vitest";

import { createTestNotificationHandler } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const subscription = {
  id: ID,
  endpoint: "https://push.example/device",
  p256dh: "public-key",
  auth: "auth-secret",
};

describe("POST /api/v1/notifications/test", () => {
  it("sends a redacted test only to the requested account-owned browser", async () => {
    const send = vi.fn().mockResolvedValue("sent");
    const POST = createTestNotificationHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user-1" }),
      getRepository: () =>
        ({ getSubscription: vi.fn().mockResolvedValue(subscription) }) as never,
      getPushAdapter: () => ({ send }),
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(
      new Request("https://rails.example/api/v1/notifications/test", {
        method: "POST",
        body: JSON.stringify({ subscriptionId: ID }),
      }),
    );

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledWith(
      subscription,
      '{"kind":"test","href":"/settings"}',
    );
  });

  it("does not disclose another account's subscription", async () => {
    const POST = createTestNotificationHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user-1" }),
      getRepository: () =>
        ({ getSubscription: vi.fn().mockResolvedValue(null) }) as never,
      getPushAdapter: () => ({ send: vi.fn() }),
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(
      new Request("https://rails.example/api/v1/notifications/test", {
        method: "POST",
        body: JSON.stringify({ subscriptionId: ID }),
      }),
    );

    expect(response.status).toBe(404);
  });
});
