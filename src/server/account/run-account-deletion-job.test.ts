import { describe, expect, it, vi } from "vitest";

import { runAccountDeletionJob } from "./run-account-deletion-job";

const job = {
  id: "job_1",
  userId: "user_1",
  pseudonymousAccountId: "pseudo_1",
  status: "pending" as const,
  attempts: 0,
  lastErrorCode: null,
  requestedAt: new Date("2026-07-28T12:00:00.000Z"),
  completedAt: null,
  purgeAfter: new Date("2026-08-27T12:00:00.000Z"),
};

function repository(overrides: Record<string, unknown> = {}) {
  return {
    getById: vi.fn().mockResolvedValue(job),
    markProcessing: vi.fn().mockResolvedValue(true),
    listIdentityProviderTokens: vi
      .fn()
      .mockResolvedValue(["identity-refresh-token"]),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    ...overrides,
  };
}

describe("runAccountDeletionJob", () => {
  it("revokes provider grants before permanently removing account data", async () => {
    const calls: string[] = [];
    const repo = repository({
      markCompleted: vi.fn(async () => calls.push("delete")),
    });
    const disconnectCalendar = vi.fn(async () => calls.push("calendar"));
    const revoke = vi.fn(async () => calls.push("identity"));

    await expect(
      runAccountDeletionJob(
        {
          repository: repo as never,
          disconnectCalendar,
          revokeProviderToken: revoke,
          now: () => new Date("2026-07-28T12:01:00.000Z"),
        },
        "job_1",
      ),
    ).resolves.toEqual({ status: "completed" });

    expect(calls).toEqual(["calendar", "identity", "delete"]);
    expect(disconnectCalendar).toHaveBeenCalledWith("user_1");
    expect(revoke).toHaveBeenCalledWith("identity-refresh-token");
  });

  it("records a safe failure and leaves access disabled for a durable retry", async () => {
    const repo = repository();
    const failure = new Error("database unavailable");

    await expect(
      runAccountDeletionJob(
        {
          repository: repo as never,
          disconnectCalendar: vi.fn().mockRejectedValue(failure),
          revokeProviderToken: vi.fn(),
          now: () => new Date("2026-07-28T12:01:00.000Z"),
        },
        "job_1",
      ),
    ).rejects.toThrow("database unavailable");

    expect(repo.markFailed).toHaveBeenCalledWith(
      "job_1",
      "cleanup_failed",
      "job_1",
      new Date("2026-07-28T12:01:00.000Z"),
    );
    expect(repo.markCompleted).not.toHaveBeenCalled();
  });

  it("is idempotent after completion", async () => {
    const repo = repository({
      getById: vi
        .fn()
        .mockResolvedValue({ ...job, userId: null, status: "completed" }),
    });

    await expect(
      runAccountDeletionJob(
        {
          repository: repo as never,
          disconnectCalendar: vi.fn(),
          revokeProviderToken: vi.fn(),
        },
        "job_1",
      ),
    ).resolves.toEqual({
      status: "skipped",
      reason: "already_finished",
    });
    expect(repo.markProcessing).not.toHaveBeenCalled();
  });

  it("does not duplicate provider cleanup when another worker owns the lease", async () => {
    const repo = repository({
      markProcessing: vi.fn().mockResolvedValue(false),
    });
    const disconnectCalendar = vi.fn();
    const revokeProviderToken = vi.fn();

    await expect(
      runAccountDeletionJob(
        {
          repository: repo as never,
          disconnectCalendar,
          revokeProviderToken,
        },
        "job_1",
      ),
    ).resolves.toEqual({
      status: "skipped",
      reason: "already_processing",
    });
    expect(disconnectCalendar).not.toHaveBeenCalled();
    expect(revokeProviderToken).not.toHaveBeenCalled();
  });
});
