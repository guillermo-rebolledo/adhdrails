import { describe, expect, it, vi } from "vitest";

import type { AccountProfile } from "@/server/account/repository";

import { createTimeZoneRouteHandlers } from "./route";

function profile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    userId: "user_1",
    email: "person@example.com",
    name: "Person Example",
    timezone: "America/Mexico_City",
    locale: "en-US",
    onboardingCompletedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    captureTimeZone: vi.fn(),
    completeOnboarding: vi.fn(),
    ...overrides,
  };
}

const post = (body?: unknown) =>
  new Request("https://rails.example/api/v1/account/timezone", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("POST /api/v1/account/timezone", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const captureTimeZone = vi.fn();
    const { POST } = createTimeZoneRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service({ captureTimeZone }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post({ timezone: "America/Mexico_City" }));

    expect(response.status).toBe(401);
    expect(captureTimeZone).not.toHaveBeenCalled();
  });

  it("captures the zone for the signed-in account only", async () => {
    const captured = profile();
    const captureTimeZone = vi
      .fn()
      .mockResolvedValue({ ok: true, profile: captured });
    const { POST } = createTimeZoneRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ captureTimeZone }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post({ timezone: "America/Mexico_City" }));

    expect(response.status).toBe(200);
    // Scope comes from the session, never from the request body.
    expect(captureTimeZone).toHaveBeenCalledWith("user_1", {
      timezone: "America/Mexico_City",
    });
    await expect(response.json()).resolves.toMatchObject({
      timezone: "America/Mexico_City",
    });
  });

  it("rejects an unusable zone with a validation problem", async () => {
    const { POST } = createTimeZoneRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () =>
        service({
          captureTimeZone: vi.fn().mockResolvedValue({
            ok: false,
            reason: "invalid",
            fieldErrors: { timezone: ["Unknown time zone."] },
          }),
        }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post({ timezone: "Mars/Phobos" }));

    expect(response.status).toBe(422);
  });

  it("serializes an account whose zone is still unknown", async () => {
    const { POST } = createTimeZoneRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () =>
        service({
          captureTimeZone: vi.fn().mockResolvedValue({
            ok: true,
            profile: profile({ timezone: null }),
          }),
        }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post({ timezone: "America/Mexico_City" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ timezone: null });
  });
});
