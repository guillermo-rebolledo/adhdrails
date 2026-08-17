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
    captureTimeZone: vi.fn(),
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

describe("captureTimeZone", () => {
  it("records a detected zone for an account that has none", async () => {
    const captured = profile({ timezone: "America/Mexico_City" });
    const captureTimeZone = vi.fn().mockResolvedValue(captured);
    const service = createAccountService(repository({ captureTimeZone }));

    await expect(
      service.captureTimeZone("user_1", { timezone: "America/Mexico_City" }),
    ).resolves.toEqual({ ok: true, profile: captured });
    expect(captureTimeZone).toHaveBeenCalledWith("user_1", {
      timezone: "America/Mexico_City",
    });
  });

  it("succeeds without changing anything when a zone is already known", async () => {
    // The repository's IS NULL guard declines the write, which is the expected
    // outcome on every load after the first — not a failure the client must
    // handle.
    const existing = profile({ timezone: "Europe/Madrid" });
    const service = createAccountService(
      repository({
        captureTimeZone: vi.fn().mockResolvedValue(null),
        getProfile: vi.fn().mockResolvedValue(existing),
      }),
    );

    await expect(
      service.captureTimeZone("user_1", { timezone: "America/Mexico_City" }),
    ).resolves.toEqual({ ok: true, profile: existing });
  });

  it("rejects an unusable zone before touching the repository", async () => {
    const captureTimeZone = vi.fn();
    const service = createAccountService(repository({ captureTimeZone }));

    const result = await service.captureTimeZone("user_1", {
      timezone: "Mars/Phobos",
    });

    expect(result.ok).toBe(false);
    expect(captureTimeZone).not.toHaveBeenCalled();
  });

  it("reports not_found when the account does not exist at all", async () => {
    const service = createAccountService(
      repository({
        captureTimeZone: vi.fn().mockResolvedValue(null),
        getProfile: vi.fn().mockResolvedValue(null),
      }),
    );

    await expect(
      service.captureTimeZone("user_1", { timezone: "America/Mexico_City" }),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
  });
});
