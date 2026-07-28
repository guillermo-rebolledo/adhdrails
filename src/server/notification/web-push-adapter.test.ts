import webPush from "web-push";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWebPushAdapter } from "./web-push-adapter";

vi.mock("web-push", () => ({
  default: { sendNotification: vi.fn() },
}));

const subscription = {
  id: "device-1",
  endpoint: "https://push.example/device",
  p256dh: "public-key",
  auth: "auth-secret",
};
const config = {
  subject: "mailto:support@rails.app",
  publicKey: "vapid-public",
  privateKey: "vapid-private",
};

describe("Web Push adapter", () => {
  beforeEach(() => {
    vi.mocked(webPush.sendNotification).mockReset();
  });

  it("sends a short-lived payload with per-request VAPID details", async () => {
    vi.mocked(webPush.sendNotification).mockResolvedValue({
      statusCode: 201,
      headers: {},
      body: "",
    });

    await expect(
      createWebPushAdapter(config).send(subscription, '{"kind":"test"}'),
    ).resolves.toBe("sent");

    expect(webPush.sendNotification).toHaveBeenCalledWith(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: "public-key", auth: "auth-secret" },
      },
      '{"kind":"test"}',
      {
        TTL: 300,
        urgency: "normal",
        vapidDetails: config,
      },
    );
  });

  it.each([404, 410])(
    "classifies a %s response as an expired subscription",
    async (statusCode) => {
      vi.mocked(webPush.sendNotification).mockRejectedValue({ statusCode });

      await expect(
        createWebPushAdapter(config).send(subscription, '{"kind":"test"}'),
      ).resolves.toBe("expired");
    },
  );

  it("keeps transient provider failures retryable", async () => {
    vi.mocked(webPush.sendNotification).mockRejectedValue({ statusCode: 503 });

    await expect(
      createWebPushAdapter(config).send(subscription, '{"kind":"test"}'),
    ).rejects.toThrow("Web Push delivery failed.");
  });
});
