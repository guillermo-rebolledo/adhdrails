import { describe, expect, it, vi } from "vitest";

import { MINIMUM_RETENTION_DAYS, assertPitrRetention } from "./neon-retention";

const environment = {
  NEON_API_KEY: "secret-api-key",
  NEON_PROJECT_ID: "rails-production",
};

function projectResponse(historyRetentionSeconds: number) {
  return Response.json({
    project: { history_retention_seconds: historyRetentionSeconds },
  });
}

describe("Neon point-in-time recovery retention", () => {
  it("passes when retention meets the minimum window", async () => {
    const sevenDays = 7 * 24 * 60 * 60;
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(projectResponse(sevenDays));

    const result = await assertPitrRetention({
      environment,
      fetchImplementation,
    });

    expect(result).toEqual({ retentionSeconds: sevenDays, retentionDays: 7 });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("passes when retention exceeds the minimum window", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(projectResponse(14 * 24 * 60 * 60));

    await expect(
      assertPitrRetention({ environment, fetchImplementation }),
    ).resolves.toMatchObject({ retentionDays: 14 });
  });

  it("fails closed when retention is shorter than the minimum window", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(projectResponse(3 * 24 * 60 * 60));

    await expect(
      assertPitrRetention({ environment, fetchImplementation }),
    ).rejects.toThrow(
      `Neon point-in-time recovery retention is 3 days; at least ${MINIMUM_RETENTION_DAYS} days are required.`,
    );
  });

  it("requires the Neon credentials", async () => {
    await expect(
      assertPitrRetention({
        environment: { NEON_PROJECT_ID: "rails-production" },
        fetchImplementation: vi.fn<typeof fetch>(),
      }),
    ).rejects.toThrow("NEON_API_KEY");
  });

  it("rejects a malformed API response instead of assuming coverage", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ project: {} }));

    await expect(
      assertPitrRetention({ environment, fetchImplementation }),
    ).rejects.toThrow("Neon project response was invalid.");
  });

  it("surfaces a non-OK API status", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("nope", { status: 403 }));

    await expect(
      assertPitrRetention({ environment, fetchImplementation }),
    ).rejects.toThrow("Neon retention lookup failed with status 403.");
  });
});
