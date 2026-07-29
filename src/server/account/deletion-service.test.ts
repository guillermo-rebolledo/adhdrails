import { describe, expect, it, vi } from "vitest";

import { ACCOUNT_DELETION_CONFIRMATION } from "@/domain/account/deletion";

import { createRecordingAccountDeletionDispatcher } from "./deletion-dispatcher";
import { createAccountDeletionService } from "./deletion-service";

const requestedAt = new Date("2026-07-28T12:00:00.000Z");
const record = {
  id: "4e5f058d-1448-4fcf-904d-d51501971033",
  userId: "user_1",
  pseudonymousAccountId: "410b67d3-6af5-4f31-9881-8a83363732e4",
  status: "pending" as const,
  attempts: 0,
  lastErrorCode: null,
  requestedAt,
  completedAt: null,
  purgeAfter: new Date("2026-08-27T12:00:00.000Z"),
};

describe("createAccountDeletionService", () => {
  it("returns a safe status for an opaque receipt", async () => {
    const service = createAccountDeletionService({
      repository: {
        getById: vi.fn().mockResolvedValue(record),
      } as never,
      dispatcher: createRecordingAccountDeletionDispatcher(),
    });

    await expect(service.getStatus(record.id)).resolves.toEqual({
      id: record.id,
      status: "pending",
      requestedAt: requestedAt.toISOString(),
      completedAt: null,
      errorCode: null,
    });
  });

  it("rejects anything except the exact typed confirmation", async () => {
    const repository = { create: vi.fn() };
    const service = createAccountDeletionService({
      repository: repository as never,
      dispatcher: createRecordingAccountDeletionDispatcher(),
    });

    await expect(
      service.requestDeletion("user_1", { confirmation: "DELETE" }, "cor_1"),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("disables the account durably and dispatches cleanup", async () => {
    const repository = {
      create: vi.fn().mockResolvedValue({ created: true, record }),
    };
    const dispatcher = createRecordingAccountDeletionDispatcher();
    const service = createAccountDeletionService({
      repository: repository as never,
      dispatcher,
      now: () => requestedAt,
    });

    const result = await service.requestDeletion(
      "user_1",
      { confirmation: ACCOUNT_DELETION_CONFIRMATION },
      "cor_1",
    );

    expect(result).toMatchObject({
      ok: true,
      created: true,
      status: { id: record.id, status: "pending" },
    });
    expect(repository.create).toHaveBeenCalledWith(
      "user_1",
      "cor_1",
      requestedAt,
    );
    expect(dispatcher.dispatched).toEqual([record.id]);
  });

  it("still confirms deletion when inline dispatch fails", async () => {
    const service = createAccountDeletionService({
      repository: {
        create: vi.fn().mockResolvedValue({ created: true, record }),
      } as never,
      dispatcher: createRecordingAccountDeletionDispatcher({
        failWith: new Error("Inngest unavailable"),
      }),
      now: () => requestedAt,
    });

    await expect(
      service.requestDeletion(
        "user_1",
        { confirmation: ACCOUNT_DELETION_CONFIRMATION },
        "cor_1",
      ),
    ).resolves.toMatchObject({ ok: true, status: { status: "pending" } });
  });
});
