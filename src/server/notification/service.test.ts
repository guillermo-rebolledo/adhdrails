import { describe, expect, it, vi } from "vitest";

import { createNotificationService } from "./service";

const subscription = {
  id: "11111111-1111-4111-8111-111111111111",
  endpoint: "https://push.example/device",
  p256dh: "public-key",
  auth: "auth-secret",
};

function repository(stored: typeof subscription | null = subscription) {
  return {
    getPreferences: vi.fn(),
    savePreferences: vi.fn(),
    saveSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
    getSubscription: vi.fn().mockResolvedValue(stored),
    listCandidates: vi.fn(),
    listRetries: vi.fn(),
    claimDelivery: vi.fn(),
    completeDelivery: vi.fn(),
    failDelivery: vi.fn(),
  };
}

describe("NotificationService.sendTest", () => {
  it("sends a content-safe test to the account-owned subscription", async () => {
    const send = vi.fn().mockResolvedValue("sent");
    const service = createNotificationService(repository() as never, () => ({
      send,
    }));

    await expect(service.sendTest("user-1", subscription.id)).resolves.toBe(
      "sent",
    );
    expect(send).toHaveBeenCalledWith(
      subscription,
      '{"kind":"test","href":"/settings"}',
    );
  });

  it("removes an expired subscription and hides missing subscriptions", async () => {
    const repo = repository();
    const service = createNotificationService(repo as never, () => ({
      send: vi.fn().mockResolvedValue("expired"),
    }));

    await expect(service.sendTest("user-1", subscription.id)).resolves.toBe(
      "expired",
    );
    expect(repo.deleteSubscription).toHaveBeenCalledWith(
      "user-1",
      subscription.id,
    );

    const getPushAdapter = vi.fn();
    const missing = createNotificationService(
      repository(null) as never,
      getPushAdapter,
    );
    await expect(missing.sendTest("user-1", subscription.id)).resolves.toBe(
      "not_found",
    );
    expect(getPushAdapter).not.toHaveBeenCalled();
  });
});
