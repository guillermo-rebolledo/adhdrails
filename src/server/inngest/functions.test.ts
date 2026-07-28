import { describe, expect, it, vi } from "vitest";

const run = vi.fn().mockResolvedValue({
  delivered: 1,
  expired: 0,
  failed: 0,
});

vi.mock("@/server/notification/service-factory", () => ({
  getReminderDeliveryService: () => ({ run }),
}));
vi.mock("@/server/observability/logger", () => ({
  logOperationalEvent: vi.fn(),
}));

import { timedTaskReminders } from "./functions";

describe("timed Task reminder Inngest function", () => {
  it("runs once per minute with bounded concurrency and retry", async () => {
    const fn = timedTaskReminders as unknown as {
      opts: {
        retries: number;
        concurrency: { limit: number };
        triggers: { cron: string }[];
      };
      fn: () => Promise<unknown>;
    };

    expect(fn.opts).toMatchObject({
      retries: 3,
      concurrency: { limit: 1 },
      triggers: [{ cron: "* * * * *" }],
    });
    await expect(fn.fn()).resolves.toEqual({
      delivered: 1,
      expired: 0,
      failed: 0,
    });
    expect(run).toHaveBeenCalledWith(expect.any(Date));
  });
});
