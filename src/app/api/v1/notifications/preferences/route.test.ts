import { describe, expect, it, vi } from "vitest";

import { DEFAULT_REMINDER_PREFERENCES } from "@/domain/notification/reminder";

import { createNotificationPreferenceHandlers } from "./route";

function request(method = "GET", body?: unknown) {
  return new Request("https://rails.example/api/v1/notifications/preferences", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/v1/notifications/preferences", () => {
  it("rejects unauthenticated reads and writes", async () => {
    const handlers = createNotificationPreferenceHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => ({}) as never,
      createCorrelationId: () => "cor_1",
    });

    expect((await handlers.GET(request())).status).toBe(401);
    expect((await handlers.PUT(request("PUT", {}))).status).toBe(401);
  });

  it("reads and saves the complete account preference set", async () => {
    const saved = {
      ...DEFAULT_REMINDER_PREFERENCES,
      enabled: true,
      leadMinutes: 30 as const,
    };
    const getPreferences = vi
      .fn()
      .mockResolvedValue(DEFAULT_REMINDER_PREFERENCES);
    const savePreferences = vi.fn().mockResolvedValue(saved);
    const handlers = createNotificationPreferenceHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user-1" }),
      getService: () => ({ getPreferences, savePreferences }) as never,
      createCorrelationId: () => "cor_1",
    });

    await expect((await handlers.GET(request())).json()).resolves.toEqual(
      DEFAULT_REMINDER_PREFERENCES,
    );
    const response = await handlers.PUT(request("PUT", saved));

    expect(response.status).toBe(200);
    expect(savePreferences).toHaveBeenCalledWith("user-1", saved);
    await expect(response.json()).resolves.toEqual(saved);
  });

  it("rejects an unsupported lead time", async () => {
    const handlers = createNotificationPreferenceHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user-1" }),
      getService: () => ({ savePreferences: vi.fn() }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await handlers.PUT(
      request("PUT", {
        ...DEFAULT_REMINDER_PREFERENCES,
        leadMinutes: 20,
      }),
    );

    expect(response.status).toBe(422);
  });
});
