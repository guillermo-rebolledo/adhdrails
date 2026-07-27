import { describe, expect, it, vi } from "vitest";

import type { AccountProfile } from "@/server/account/repository";

import { createAccountRouteHandlers } from "./route";

function profile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    userId: "user_1",
    email: "person@example.com",
    name: "Person Example",
    timezone: "America/New_York",
    locale: "en-US",
    onboardingCompletedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    completeOnboarding: vi.fn(),
    ...overrides,
  };
}

const request = (body?: unknown) =>
  new Request("https://rails.example/api/v1/account", {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("GET /api/v1/account", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { GET } = createAccountRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getRepository: () => repository() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request("https://rails.example/api/v1/account"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "unauthorized",
    });
  });

  it("returns the account profile scoped to the signed-in user", async () => {
    const getProfile = vi.fn().mockResolvedValue(profile());
    const { GET } = createAccountRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getRepository: () => repository({ getProfile }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request("https://rails.example/api/v1/account"),
    );

    expect(response.status).toBe(200);
    expect(getProfile).toHaveBeenCalledWith("user_1");
    await expect(response.json()).resolves.toMatchObject({
      email: "person@example.com",
      timezone: "America/New_York",
      onboardingCompleted: true,
    });
  });
});

describe("PATCH /api/v1/account", () => {
  it("rejects an invalid time zone with a validation problem", async () => {
    const updateProfile = vi.fn();
    const { PATCH } = createAccountRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getRepository: () => repository({ updateProfile }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(
      request({ timezone: "Nowhere/Void", locale: "en-US" }),
    );

    expect(response.status).toBe(422);
    expect(updateProfile).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "validation_failed",
    });
  });

  it("saves a valid profile update", async () => {
    const updateProfile = vi
      .fn()
      .mockResolvedValue(profile({ timezone: "Europe/Madrid" }));
    const { PATCH } = createAccountRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getRepository: () => repository({ updateProfile }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(
      request({ timezone: "Europe/Madrid", locale: "en-GB" }),
    );

    expect(response.status).toBe(200);
    expect(updateProfile).toHaveBeenCalledWith("user_1", {
      timezone: "Europe/Madrid",
      locale: "en-GB",
    });
    await expect(response.json()).resolves.toMatchObject({
      timezone: "Europe/Madrid",
    });
  });
});
