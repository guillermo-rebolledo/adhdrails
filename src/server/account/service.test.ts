import { describe, expect, it, vi } from "vitest";

import type { AccountProfile } from "./repository";
import { createAccountService } from "./service";

function profile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    userId: "user_1",
    email: "p@example.com",
    name: "P",
    timezone: "Europe/Madrid",
    locale: "en-GB",
    onboardingCompletedAt: null,
    ...overrides,
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    completeOnboarding: vi.fn(),
    ...overrides,
  } as never;
}

describe("createAccountService", () => {
  it("reports not_found when the account is missing", async () => {
    const service = createAccountService(
      repository({ getProfile: vi.fn().mockResolvedValue(null) }),
    );

    await expect(service.getProfile("user_1")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("validates input before touching the repository", async () => {
    const updateProfile = vi.fn();
    const service = createAccountService(repository({ updateProfile }));

    const result = await service.updateProfile("user_1", {
      timezone: "Nowhere/Void",
      locale: "en-US",
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("applies a valid, trimmed update", async () => {
    const updateProfile = vi
      .fn()
      .mockResolvedValue(profile({ timezone: "Europe/Madrid" }));
    const service = createAccountService(repository({ updateProfile }));

    const result = await service.updateProfile("user_1", {
      timezone: "  Europe/Madrid  ",
      locale: "en-GB",
    });

    expect(updateProfile).toHaveBeenCalledWith("user_1", {
      timezone: "Europe/Madrid",
      locale: "en-GB",
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("completes onboarding through the repository", async () => {
    const completeOnboarding = vi
      .fn()
      .mockResolvedValue(profile({ onboardingCompletedAt: new Date() }));
    const service = createAccountService(repository({ completeOnboarding }));

    const result = await service.completeOnboarding("user_1", {
      timezone: "UTC",
      locale: "en-US",
    });

    expect(completeOnboarding).toHaveBeenCalledWith("user_1", {
      timezone: "UTC",
      locale: "en-US",
    });
    expect(result).toMatchObject({ ok: true });
  });
});
