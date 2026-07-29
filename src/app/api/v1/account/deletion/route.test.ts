import { describe, expect, it, vi } from "vitest";

import { ACCOUNT_DELETION_CONFIRMATION } from "@/domain/account/deletion";

import { createAccountDeletionRouteHandlers } from "./route";

const request = (body: unknown) =>
  new Request("https://rails.example/api/v1/account/deletion", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/v1/account/deletion", () => {
  it("requires an authenticated account", async () => {
    const { POST } = createAccountDeletionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => ({ requestDeletion: vi.fn() }) as never,
      createCorrelationId: () => "cor_1",
    });

    expect(
      (await POST(request({ confirmation: ACCOUNT_DELETION_CONFIRMATION })))
        .status,
    ).toBe(401);
  });

  it("rejects an incorrect typed confirmation", async () => {
    const requestDeletion = vi.fn().mockResolvedValue({
      ok: false,
      reason: "invalid",
      fieldErrors: { confirmation: ["Invalid input"] },
    });
    const { POST } = createAccountDeletionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => ({ requestDeletion }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(request({ confirmation: "DELETE" }));
    expect(response.status).toBe(422);
  });

  it("returns server-confirmed durable status instead of an optimistic success", async () => {
    const status = {
      id: "job_1",
      status: "pending",
      requestedAt: "2026-07-28T12:00:00.000Z",
      completedAt: null,
      errorCode: null,
    };
    const requestDeletion = vi.fn().mockResolvedValue({
      ok: true,
      created: true,
      status,
    });
    const { POST } = createAccountDeletionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => ({ requestDeletion }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(
      request({ confirmation: ACCOUNT_DELETION_CONFIRMATION }),
    );
    expect(response.status).toBe(202);
    expect(requestDeletion).toHaveBeenCalledWith(
      "user_1",
      { confirmation: ACCOUNT_DELETION_CONFIRMATION },
      "cor_1",
    );
    await expect(response.json()).resolves.toEqual(status);
  });
});
