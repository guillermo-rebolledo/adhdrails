import { describe, expect, it, vi } from "vitest";

import type { AccountDeletionService } from "@/server/account/deletion-service";

import { createAccountDeletionStatusRouteHandlers } from "./route";

function request() {
  return new Request(
    "http://rails.test/api/v1/account/deletion/44d77356-5801-4cd2-b662-daeb1d7fdd74",
  );
}

describe("account deletion status route", () => {
  it("returns only the safe status for an opaque receipt", async () => {
    const getStatus = vi.fn().mockResolvedValue({
      id: "44d77356-5801-4cd2-b662-daeb1d7fdd74",
      status: "processing",
      requestedAt: "2026-07-28T12:00:00.000Z",
      completedAt: null,
      errorCode: null,
    });
    const { GET } = createAccountDeletionStatusRouteHandlers({
      getService: () => ({ getStatus }) as unknown as AccountDeletionService,
      createCorrelationId: () => "6be0b73e-27a3-47bf-bd80-ce17eec91b04",
    });

    const response = await GET(request(), {
      params: Promise.resolve({
        id: "44d77356-5801-4cd2-b662-daeb1d7fdd74",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "44d77356-5801-4cd2-b662-daeb1d7fdd74",
      status: "processing",
      requestedAt: "2026-07-28T12:00:00.000Z",
      completedAt: null,
      errorCode: null,
    });
  });

  it("does not reveal whether malformed or unknown receipts exist", async () => {
    const getStatus = vi.fn().mockResolvedValue(null);
    const { GET } = createAccountDeletionStatusRouteHandlers({
      getService: () => ({ getStatus }) as unknown as AccountDeletionService,
      createCorrelationId: () => "6be0b73e-27a3-47bf-bd80-ce17eec91b04",
    });

    const malformed = await GET(request(), {
      params: Promise.resolve({ id: "not-a-receipt" }),
    });
    const unknown = await GET(request(), {
      params: Promise.resolve({
        id: "44d77356-5801-4cd2-b662-daeb1d7fdd74",
      }),
    });

    expect(malformed.status).toBe(404);
    expect(unknown.status).toBe(404);
  });
});
