import { describe, expect, it, vi } from "vitest";

import { createOnboardingRouteHandler } from "./route";

const request = (body?: unknown) =>
  new Request("https://rails.example/api/v1/account/onboarding", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("POST /api/v1/account/onboarding", () => {
  it("requires an authenticated account", async () => {
    const POST = createOnboardingRouteHandler({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getRepository: () => ({ completeOnboarding: vi.fn() }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(request({ timezone: "UTC", locale: "en-US" }));

    expect(response.status).toBe(401);
  });

  it("completes onboarding for the scoped account", async () => {
    const completeOnboarding = vi.fn().mockResolvedValue({
      userId: "user_1",
      email: "p@example.com",
      name: "P",
      timezone: "America/Chicago",
      locale: "en-US",
      onboardingCompletedAt: new Date(),
    });
    const POST = createOnboardingRouteHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getRepository: () => ({ completeOnboarding }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(
      request({ timezone: "America/Chicago", locale: "en-US" }),
    );

    expect(response.status).toBe(200);
    expect(completeOnboarding).toHaveBeenCalledWith("user_1", {
      timezone: "America/Chicago",
      locale: "en-US",
    });
    await expect(response.json()).resolves.toMatchObject({
      onboardingCompleted: true,
    });
  });
});
