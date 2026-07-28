import { describe, expect, it, vi } from "vitest";

import { createTestNotificationHandler } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
describe("POST /api/v1/notifications/test", () => {
  it("sends a redacted test only to the requested account-owned browser", async () => {
    const sendTest = vi.fn().mockResolvedValue("sent");
    const POST = createTestNotificationHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user-1" }),
      getService: () => ({ sendTest }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(
      new Request("https://rails.example/api/v1/notifications/test", {
        method: "POST",
        body: JSON.stringify({ subscriptionId: ID }),
      }),
    );

    expect(response.status).toBe(200);
    expect(sendTest).toHaveBeenCalledWith("user-1", ID);
  });

  it("does not disclose another account's subscription", async () => {
    const POST = createTestNotificationHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user-1" }),
      getService: () =>
        ({ sendTest: vi.fn().mockResolvedValue("not_found") }) as never,
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
