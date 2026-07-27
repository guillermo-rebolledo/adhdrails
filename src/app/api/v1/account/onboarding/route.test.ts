import { describe, expect, it, vi } from "vitest";

import type { AccountResult } from "@/server/account/service";

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
      getService: () => ({ completeOnboarding: vi.fn() }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(request({ timezone: "UTC", locale: "en-US" }));

    expect(response.status).toBe(401);
  });

  it("surfaces validation failures from the service", async () => {
    const completeOnboarding = vi.fn().mockResolvedValue({
      ok: false,
      reason: "invalid",
      fieldErrors: { locale: ["Unknown locale."] },
    } satisfies AccountResult);
    const POST = createOnboardingRouteHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => ({ completeOnboarding }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(request({ timezone: "UTC", locale: "@@" }));

    expect(response.status).toBe(422);
  });

  it("completes onboarding for the scoped account", async () => {
    const completeOnboarding = vi.fn().mockResolvedValue({
      ok: true,
      profile: {
        userId: "user_1",
        email: "p@example.com",
        name: "P",
        timezone: "America/Chicago",
        locale: "en-US",
        onboardingCompletedAt: new Date(),
      },
    } satisfies AccountResult);
    const POST = createOnboardingRouteHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => ({ completeOnboarding }) as never,
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
