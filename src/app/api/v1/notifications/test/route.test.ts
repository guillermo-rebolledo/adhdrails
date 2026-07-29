import { describe, expect, it, vi } from "vitest";

import { createInMemoryRateLimiter } from "@/server/rate-limit/limiter";

import { createTestNotificationHandler } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";

function request() {
  return new Request("https://rails.example/api/v1/notifications/test", {
    method: "POST",
    body: JSON.stringify({ subscriptionId: ID }),
  });
}

describe("POST /api/v1/notifications/test", () => {
  it("sends a redacted test only to the requested account-owned browser", async () => {
    const sendTest = vi.fn().mockResolvedValue("sent");
    const POST = createTestNotificationHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user-1" }),
      getService: () => ({ sendTest }) as never,
      createCorrelationId: () => "cor_1",
      rateLimiter: createInMemoryRateLimiter(),
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(sendTest).toHaveBeenCalledWith("user-1", ID);
  });

  it("does not disclose another account's subscription", async () => {
    const POST = createTestNotificationHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user-1" }),
      getService: () =>
        ({ sendTest: vi.fn().mockResolvedValue("not_found") }) as never,
      createCorrelationId: () => "cor_1",
      rateLimiter: createInMemoryRateLimiter(),
    });

    const response = await POST(request());

    expect(response.status).toBe(404);
  });

  it("throttles repeated test sends from one account with 429", async () => {
    const sendTest = vi.fn().mockResolvedValue("sent");
    const POST = createTestNotificationHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user-1" }),
      getService: () => ({ sendTest }) as never,
      createCorrelationId: () => "cor_1",
      rateLimiter: createInMemoryRateLimiter(),
    });

    let last: Response | undefined;
    for (let i = 0; i < 6; i += 1) {
      last = await POST(request());
    }

    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toBeTruthy();
    // The rule allows 5/minute, so the provider was hit at most five times.
    expect(sendTest).toHaveBeenCalledTimes(5);
  });
});
