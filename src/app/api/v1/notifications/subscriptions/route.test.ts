import { describe, expect, it, vi } from "vitest";

import { createPushSubscriptionHandlers } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const input = {
  id: ID,
  endpoint: "https://push.example/device",
  expirationTime: null,
  keys: { p256dh: "public-key", auth: "auth-secret" },
};

function request(method: string, body: unknown) {
  return new Request(
    "https://rails.example/api/v1/notifications/subscriptions",
    { method, body: JSON.stringify(body) },
  );
}

describe("/api/v1/notifications/subscriptions", () => {
  it("stores and removes only the signed-in browser subscription", async () => {
    const saveSubscription = vi.fn();
    const deleteSubscription = vi.fn();
    const handlers = createPushSubscriptionHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user-1" }),
      getRepository: () => ({ saveSubscription, deleteSubscription }) as never,
      createCorrelationId: () => "cor_1",
    });

    expect((await handlers.POST(request("POST", input))).status).toBe(201);
    expect(saveSubscription).toHaveBeenCalledWith("user-1", {
      id: ID,
      endpoint: input.endpoint,
      expirationTime: null,
      p256dh: "public-key",
      auth: "auth-secret",
    });

    expect((await handlers.DELETE(request("DELETE", { id: ID }))).status).toBe(
      200,
    );
    expect(deleteSubscription).toHaveBeenCalledWith("user-1", ID);
  });

  it("rejects malformed provider credentials", async () => {
    const handlers = createPushSubscriptionHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user-1" }),
      getRepository: () => ({ saveSubscription: vi.fn() }) as never,
      createCorrelationId: () => "cor_1",
    });

    expect(
      (
        await handlers.POST(
          request("POST", { ...input, endpoint: "javascript:alert(1)" }),
        )
      ).status,
    ).toBe(422);
  });
});
