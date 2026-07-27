import { inboxTitleSchema } from "@/domain/inbox/capture";

import type { LocalInboxItem, OutboxEntry, RailsDatabase } from "./db";

export interface CaptureOptions {
  /** Override the generated ids/timestamp — used only by tests. */
  id?: string;
  idempotencyKey?: string;
  outboxId?: string;
  now?: string;
}

/**
 * Quick Capture's single local command. In one atomic Dexie transaction it
 * writes the optimistic Inbox Item and its outbox entry, so a capture is never
 * acknowledged locally without a durable instruction to synchronize it. The
 * write is title-only; classification happens later. Returns the optimistic
 * item so the caller can acknowledge within its performance budget.
 */
export async function captureInboxItem(
  db: RailsDatabase,
  rawTitle: string,
  options: CaptureOptions = {},
): Promise<LocalInboxItem> {
  const title = inboxTitleSchema.parse(rawTitle);
  const id = options.id ?? crypto.randomUUID();
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const createdAt = options.now ?? new Date().toISOString();

  const item: LocalInboxItem = {
    id,
    title,
    seen: false,
    version: 1,
    createdAt,
    syncState: "pending",
  };

  const entry: OutboxEntry = {
    id: options.outboxId ?? crypto.randomUUID(),
    entity: "inbox_item",
    operation: "create",
    entityId: id,
    idempotencyKey,
    baseVersion: null,
    payload: { id, title, idempotencyKey },
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt,
  };

  await db.transaction("rw", db.inboxItems, db.outbox, async () => {
    await db.inboxItems.add(item);
    await db.outbox.add(entry);
  });

  return item;
}
