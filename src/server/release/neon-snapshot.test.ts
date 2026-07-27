import { describe, expect, it, vi } from "vitest";

import { createNeonRestorePoint } from "./neon-snapshot";

const environment = {
  NEON_API_KEY: "secret-api-key",
  NEON_BRANCH_ID: "br-production",
  NEON_PROJECT_ID: "rails-production",
};

describe("Neon restore points", () => {
  it("waits for every asynchronous operation before succeeding", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          snapshot: { id: "snap-one" },
          operations: [
            { id: "00000000-0000-4000-8000-000000000001" },
            { id: "00000000-0000-4000-8000-000000000002" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ operation: { status: "running" } }),
      )
      .mockResolvedValueOnce(
        Response.json({ operation: { status: "finished" } }),
      )
      .mockResolvedValueOnce(
        Response.json({ operation: { status: "finished" } }),
      );
    const sleep = vi.fn(async () => undefined);

    await createNeonRestorePoint({
      environment,
      fetchImplementation,
      sleep,
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("fails closed when an operation does not finish successfully", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          snapshot: { id: "snap-one" },
          operations: [{ id: "00000000-0000-4000-8000-000000000001" }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ operation: { status: "failed" } }),
      );

    await expect(
      createNeonRestorePoint({ environment, fetchImplementation }),
    ).rejects.toThrow("Neon restore-point operation failed.");
  });

  it("rejects malformed API responses instead of migrating without proof", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ snapshot: {} }));

    await expect(
      createNeonRestorePoint({ environment, fetchImplementation }),
    ).rejects.toThrow("Neon restore-point response was invalid.");
  });
});
