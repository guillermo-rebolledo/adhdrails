import { describe, expect, it, vi } from "vitest";

import { RESTORE_TIME_OBJECTIVE_MS, runRestoreDrill } from "./restore-drill";

const environment = {
  NEON_API_KEY: "secret-api-key",
  NEON_PROJECT_ID: "rails-production",
  NEON_BRANCH_ID: "br-production",
};

function branchCreatedResponse() {
  return Response.json({
    branch: { id: "br-drill" },
    operations: [{ id: "op-1" }],
  });
}

function operationResponse(status: string) {
  return Response.json({ operation: { status } });
}

describe("restore drill", () => {
  it("restores to a point in time, times it, and cleans up", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(branchCreatedResponse())
      .mockResolvedValueOnce(operationResponse("finished"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    // Restore finishes eight minutes after it starts: start, poll check, and
    // the final elapsed reading.
    const clock = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(8 * 60 * 1000)
      .mockReturnValueOnce(8 * 60 * 1000);

    const result = await runRestoreDrill({
      environment,
      fetchImplementation,
      clock,
      sleep: async () => undefined,
    });

    expect(result).toEqual({
      restoreBranchId: "br-drill",
      elapsedMs: 8 * 60 * 1000,
      cleanedUp: true,
    });

    // Branch create, operation poll, branch delete.
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    const deleteCall = fetchImplementation.mock.calls[2];
    expect(deleteCall?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("fails when recovery exceeds the four-hour objective", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(branchCreatedResponse());
    // Start, then a poll-time reading past the objective deadline.
    const clock = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(RESTORE_TIME_OBJECTIVE_MS + 1);

    await expect(
      runRestoreDrill({
        environment,
        fetchImplementation,
        clock,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/exceeded the .* recovery objective/);
  });

  it("fails closed when the restore operation does not finish", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(branchCreatedResponse())
      .mockResolvedValueOnce(operationResponse("failed"));

    await expect(
      runRestoreDrill({
        environment,
        fetchImplementation,
        clock: () => 0,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("Neon restore operation failed.");
  });

  it("requires the Neon credentials", async () => {
    await expect(
      runRestoreDrill({
        environment: { NEON_API_KEY: "x" },
        fetchImplementation: vi.fn<typeof fetch>(),
      }),
    ).rejects.toThrow("NEON_PROJECT_ID");
  });
});
