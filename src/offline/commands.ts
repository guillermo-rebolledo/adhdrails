import { inboxTitleSchema } from "@/domain/inbox/capture";
import {
  thoughtBodySchema,
  thoughtTitleSchema,
} from "@/domain/thought/thought";

import type {
  LocalInboxItem,
  LocalThought,
  OutboxEntry,
  OutboxOperation,
  RailsDatabase,
} from "./db";

export interface CaptureOptions {
  /** Override the generated ids/timestamp — used only by tests. */
  id?: string;
  idempotencyKey?: string;
  outboxId?: string;
  now?: string;
}

let lastMutationSequence = 0;

function nextMutationSequence(): number {
  lastMutationSequence = Math.max(Date.now(), lastMutationSequence + 1);
  return lastMutationSequence;
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
    sequence: nextMutationSequence(),
  };

  await db.transaction("rw", db.inboxItems, db.outbox, async () => {
    await db.inboxItems.add(item);
    await db.outbox.add(entry);
  });

  return item;
}

interface ThoughtInput {
  title: string;
  body: string;
  sourceInboxItemId?: string | null;
}

function thoughtEntry(
  thought: LocalThought,
  operation: OutboxOperation,
  baseVersion: number | null,
): OutboxEntry {
  const idempotencyKey = crypto.randomUUID();
  const payload =
    operation === "create"
      ? {
          id: thought.id,
          title: thought.title,
          body: thought.body,
          sourceInboxItemId: thought.sourceInboxItemId,
          idempotencyKey,
        }
      : operation === "update"
        ? {
            title: thought.title,
            body: thought.body,
            baseVersion,
            idempotencyKey,
          }
        : { deleted: true, baseVersion, idempotencyKey };

  return {
    id: crypto.randomUUID(),
    entity: "thought",
    operation,
    entityId: thought.id,
    idempotencyKey,
    baseVersion,
    payload,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    sequence: nextMutationSequence(),
  };
}

function newThought(input: ThoughtInput): {
  thought: LocalThought;
  entry: OutboxEntry;
} {
  const now = new Date().toISOString();
  const thought: LocalThought = {
    id: crypto.randomUUID(),
    title: thoughtTitleSchema.parse(input.title),
    body: thoughtBodySchema.parse(input.body),
    sourceInboxItemId: input.sourceInboxItemId ?? null,
    version: 1,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    syncState: "pending",
  };
  return { thought, entry: thoughtEntry(thought, "create", null) };
}

export async function createThought(
  db: RailsDatabase,
  input: ThoughtInput,
): Promise<LocalThought> {
  const { thought, entry } = newThought(input);
  await db.transaction("rw", db.thoughts, db.outbox, async () => {
    await db.thoughts.add(thought);
    await db.outbox.add(entry);
  });
  return thought;
}

export async function updateThought(
  db: RailsDatabase,
  id: string,
  input: Pick<ThoughtInput, "title" | "body">,
): Promise<LocalThought> {
  const current = await db.thoughts.get(id);
  if (!current || current.deletedAt) {
    throw new Error("Thought not found.");
  }
  const next: LocalThought = {
    ...current,
    title: thoughtTitleSchema.parse(input.title),
    body: thoughtBodySchema.parse(input.body),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
    syncState: "pending",
  };
  await db.transaction("rw", db.thoughts, db.outbox, async () => {
    await db.thoughts.put(next);
    await db.outbox.add(thoughtEntry(next, "update", current.version));
  });
  return next;
}

export async function deleteThoughtLocally(
  db: RailsDatabase,
  id: string,
): Promise<LocalThought> {
  const current = await db.thoughts.get(id);
  if (!current) {
    throw new Error("Thought not found.");
  }
  const now = new Date().toISOString();
  const next: LocalThought = {
    ...current,
    deletedAt: now,
    updatedAt: now,
  };
  await db.thoughts.put(next);
  return next;
}

export async function restoreThought(
  db: RailsDatabase,
  id: string,
): Promise<LocalThought> {
  const current = await db.thoughts.get(id);
  if (!current) throw new Error("Thought not found.");
  const next = { ...current, deletedAt: null };
  await db.thoughts.put(next);
  return next;
}

export async function finalizeThoughtDeletion(
  db: RailsDatabase,
  id: string,
): Promise<void> {
  await db.transaction("rw", db.thoughts, db.outbox, async () => {
    const current = await db.thoughts.get(id);
    if (!current?.deletedAt) return;
    await db.thoughts.put({ ...current, syncState: "pending" });
    await db.outbox.add(thoughtEntry(current, "delete", current.version));
  });
}

export async function classifyInboxItemAsThought(
  db: RailsDatabase,
  item: LocalInboxItem,
): Promise<LocalThought> {
  const { thought, entry } = newThought({
    title: item.title,
    body: "",
    sourceInboxItemId: item.id,
  });
  await db.transaction(
    "rw",
    db.thoughts,
    db.inboxItems,
    db.outbox,
    async () => {
      await db.thoughts.add(thought);
      await db.outbox.add(entry);
      await db.inboxItems.update(item.id, {
        classifiedAt: new Date().toISOString(),
      });
    },
  );
  return thought;
}
