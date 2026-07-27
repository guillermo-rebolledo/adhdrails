import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxItemResponse } from "@/domain/inbox/capture";

import type { OutboxEntry } from "./db";
import { createInboxSend, INBOX_ITEMS_PATH } from "./inbox-send";

const ID = "11111111-1111-4111-8111-111111111111";

function serverItem(
  overrides: Partial<InboxItemResponse> = {},
): InboxItemResponse {
  return {
    id: ID,
    title: "Buy milk",
    seen: true,
    version: 2,
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
    ...overrides,
  };
}

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: "entry-1",
    entity: "inbox_item",
    operation: "update",
    entityId: ID,
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    baseVersion: 1,
    payload: {},
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: "2026-07-27T12:00:00.000Z",
    ...overrides,
  };
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createInboxSend", () => {
  it("PATCHes an update to the item's URL and returns the confirmed item", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, serverItem()));
    const send = createInboxSend();

    const result = await send(entry());

    expect(fetchMock).toHaveBeenCalledWith(
      `${INBOX_ITEMS_PATH}/${ID}`,
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(result).toEqual({ ok: true, item: serverItem() });
  });

  it("DELETEs to the item's URL with no returned item", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const send = createInboxSend();

    const result = await send(entry({ operation: "delete" }));

    expect(fetchMock).toHaveBeenCalledWith(
      `${INBOX_ITEMS_PATH}/${ID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result).toEqual({ ok: true, item: undefined });
  });

  it("maps a 409 to a reviewable conflict carrying the server record", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { current: serverItem({ version: 9 }) }),
    );
    const send = createInboxSend();

    const result = await send(entry());

    expect(result).toEqual({
      ok: false,
      kind: "conflict",
      current: serverItem({ version: 9 }),
    });
  });

  it("maps a 410 to gone so a tombstoned item is not resurrected", async () => {
    fetchMock.mockResolvedValue(jsonResponse(410, {}));
    const send = createInboxSend();

    const result = await send(entry());

    expect(result).toEqual({ ok: false, kind: "gone" });
  });

  it("treats a thrown network error as a retryable failure", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const send = createInboxSend();

    const result = await send(entry());

    expect(result).toEqual({ ok: false, kind: "retry", message: "offline" });
  });
});
