// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxItemResponse } from "@/domain/inbox/capture";

import { captureInboxItem } from "./commands";
import { RailsDatabase } from "./db";
import {
  createSyncEngine,
  drainOutbox,
  MAX_SEND_ATTEMPTS,
  type SendResult,
} from "./sync";

function freshDatabase(): RailsDatabase {
  return new RailsDatabase(`test-${crypto.randomUUID()}`);
}

function serverItem(
  id: string,
  overrides: Partial<InboxItemResponse> = {},
): InboxItemResponse {
  return {
    id,
    title: "Buy milk",
    seen: false,
    version: 1,
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-26T10:00:00.000Z",
    ...overrides,
  };
}

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

describe("drainOutbox", () => {
  it("reconciles a confirmed capture and clears its outbox entry", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Buy milk");
    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({ ok: true, item: serverItem(item.id, { version: 3 }) }),
    );

    await drainOutbox({ db, send });

    const stored = await db.inboxItems.get(item.id);
    expect(stored).toMatchObject({ syncState: "synced", version: 3 });
    expect(await db.outbox.count()).toBe(0);
  });

  it("retains the local change and marks a conflict for review", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Buy milk");
    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({
        ok: false,
        kind: "conflict",
        current: serverItem(item.id, { title: "Buy bread" }),
      }),
    );

    await drainOutbox({ db, send });

    const stored = await db.inboxItems.get(item.id);
    // Local data is kept, not discarded, and surfaced as a conflict.
    expect(stored).toMatchObject({ syncState: "conflict", title: "Buy milk" });
    const outbox = await db.outbox.toArray();
    expect(outbox[0]).toMatchObject({
      status: "failed",
      lastError: "conflict",
    });
  });

  it("leaves a transiently failed entry pending for a later retry", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Buy milk");
    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({ ok: false, kind: "retry", message: "offline" }),
    );

    await drainOutbox({ db, send });

    const stored = await db.inboxItems.get(item.id);
    expect(stored?.syncState).toBe("pending");
    const outbox = await db.outbox.toArray();
    expect(outbox[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "offline",
    });
  });

  it("surfaces a failed state after repeated transient failures", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Buy milk");
    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({ ok: false, kind: "retry", message: "offline" }),
    );

    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
      await drainOutbox({ db, send });
    }

    const stored = await db.inboxItems.get(item.id);
    expect(stored?.syncState).toBe("failed");
    // The entry is still queued, so a later drain can recover it.
    const outbox = await db.outbox.toArray();
    expect(outbox[0]).toMatchObject({
      status: "pending",
      attempts: MAX_SEND_ATTEMPTS,
    });
  });

  it("does nothing while offline", async () => {
    db = freshDatabase();
    await captureInboxItem(db, "Buy milk");
    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>();

    await drainOutbox({ db, send, isOnline: () => false });

    expect(send).not.toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(1);
  });
});

describe("createSyncEngine", () => {
  it("drains queued captures when connectivity returns", async () => {
    db = freshDatabase();
    const item = await captureInboxItem(db, "Buy milk");
    let online = false;
    const send = vi.fn<(...args: unknown[]) => Promise<SendResult>>(
      async () => ({ ok: true, item: serverItem(item.id) }),
    );

    const engine = createSyncEngine({ db, send, isOnline: () => online });
    engine.start();
    await engine.sync();

    // Offline: the entry stays queued.
    expect(await db.outbox.count()).toBe(1);

    // Reconnect fires the online event and the queue drains.
    online = true;
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(async () => {
      expect(await db.outbox.count()).toBe(0);
    });

    engine.stop();
  });
});
