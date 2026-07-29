import { inboxTitleSchema } from "@/domain/inbox/capture";
import {
  thoughtBodySchema,
  thoughtTitleSchema,
} from "@/domain/thought/thought";

import type {
  LocalEvent,
  LocalInboxItem,
  LocalTask,
  LocalThought,
  OutboxEntry,
  OutboxOperation,
  RailsDatabase,
} from "./db";
import { buildEventCreate } from "./event-commands";
import { nextMutationSequence } from "./mutation-sequence";
import { buildTaskCreate } from "./task-commands";

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

/**
 * The compatible fields a processed capture carries into its destination. The
 * title defaults to the item's captured text but may be overridden with the
 * parser's cleaned title (schedule words stripped).
 */
export interface ClassifyOptions {
  title?: string;
}

/**
 * Converts an Inbox Item into a Thought and marks the source item classified in
 * one atomic transaction. The source row stays in the replica (only
 * `classifiedAt` is stamped), so a later failure delivering the Thought leaves
 * the capture recoverable rather than lost.
 */
export async function classifyInboxItemAsThought(
  db: RailsDatabase,
  item: LocalInboxItem,
  options: ClassifyOptions = {},
): Promise<LocalThought> {
  const { thought, entry } = newThought({
    title: options.title ?? item.title,
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

/**
 * Converts an Inbox Item into a title-only Task and marks the source item
 * classified in one atomic transaction. Detected schedule is not preserved on a
 * Task (the MVP Task carries only a title); the source row is retained so a
 * failed destination write leaves the capture recoverable.
 */
export async function classifyInboxItemAsTask(
  db: RailsDatabase,
  item: LocalInboxItem,
  options: ClassifyOptions = {},
): Promise<LocalTask> {
  const { task, entry } = buildTaskCreate({
    title: options.title ?? item.title,
  });

  await db.transaction("rw", db.tasks, db.inboxItems, db.outbox, async () => {
    await db.tasks.add(task);
    await db.outbox.add(entry);
    await db.inboxItems.update(item.id, {
      classifiedAt: new Date().toISOString(),
    });
  });

  return task;
}

export interface ClassifyEventOptions {
  title?: string;
  /** The exact start instant as an ISO-8601 string. */
  startAt: string;
  /** The IANA time zone the Event was scheduled in. */
  timeZone: string;
  /** Defaults to the 30-minute Event duration when omitted. */
  durationMinutes?: number;
}

/**
 * Converts an Inbox Item into a local timed Event and marks the source item
 * classified in one atomic transaction. Placing the item on the Calendar is the
 * conversion's explicit consequence, confirmed in the UI before this runs. The
 * source row is retained so a failed destination write leaves the capture
 * recoverable.
 */
export async function classifyInboxItemAsEvent(
  db: RailsDatabase,
  item: LocalInboxItem,
  options: ClassifyEventOptions,
): Promise<LocalEvent> {
  const { event, entry } = buildEventCreate({
    title: options.title ?? item.title,
    startAt: options.startAt,
    timeZone: options.timeZone,
    durationMinutes: options.durationMinutes,
  });

  await db.transaction("rw", db.events, db.inboxItems, db.outbox, async () => {
    await db.events.add(event);
    await db.outbox.add(entry);
    await db.inboxItems.update(item.id, {
      classifiedAt: new Date().toISOString(),
    });
  });

  return event;
}

/**
 * Marks every unseen Inbox Item seen when the Inbox is opened, clearing the
 * numberless unseen badge. Each item is stamped `seen` optimistically and, if it
 * has no pending seen update already queued, gets one idempotent update entry so
 * the server's `seenAt` catches up. Deleted items are left alone.
 */
export async function markInboxItemsSeen(db: RailsDatabase): Promise<void> {
  await db.transaction("rw", db.inboxItems, db.outbox, async () => {
    const unseen = await db.inboxItems
      .filter((item) => !item.seen && !item.classifiedAt && !item.deletedAt)
      .toArray();

    for (const item of unseen) {
      await db.inboxItems.update(item.id, { seen: true });

      const [pending] = await db.outbox
        .filter(
          (entry) =>
            entry.entityId === item.id &&
            entry.operation === "update" &&
            entry.status === "pending",
        )
        .toArray();
      if (pending) {
        continue;
      }

      const idempotencyKey = crypto.randomUUID();
      await db.outbox.add({
        id: crypto.randomUUID(),
        entity: "inbox_item",
        operation: "update",
        entityId: item.id,
        idempotencyKey,
        baseVersion: item.version,
        payload: {
          idempotencyKey,
          baseVersion: item.version,
          patch: { seen: true },
        },
        status: "pending",
        attempts: 0,
        lastError: null,
        createdAt: new Date().toISOString(),
        sequence: nextMutationSequence(),
      });
    }
  });
}

/**
 * Begins an app-owned deletion of an Inbox Item: the item is hidden
 * optimistically by stamping `deletedAt`, but nothing is sent yet. The 10-second
 * Undo window is the UI's responsibility; {@link restoreInboxItem} reverses this,
 * {@link finalizeInboxItemDeletion} commits it.
 */
export async function deleteInboxItemLocally(
  db: RailsDatabase,
  id: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  await db.inboxItems.update(id, { deletedAt: now });
}

/** Reverses a pending Inbox Item deletion within the Undo window. */
export async function restoreInboxItem(
  db: RailsDatabase,
  id: string,
): Promise<void> {
  await db.inboxItems.update(id, { deletedAt: null });
}

/**
 * Commits an app-owned Inbox Item deletion once the Undo window elapses. It
 * removes the local row and any superseded pending mutations for the item, then
 * queues one idempotent delete. The server delete writes a 30-day tombstone that
 * prevents a queued create or update from resurrecting the item.
 */
export async function finalizeInboxItemDeletion(
  db: RailsDatabase,
  id: string,
): Promise<void> {
  await db.transaction("rw", db.inboxItems, db.outbox, async () => {
    const local = await db.inboxItems.get(id);
    if (!local?.deletedAt) {
      return;
    }

    const superseded = await db.outbox
      .filter((entry) => entry.entityId === id)
      .toArray();
    await db.outbox.bulkDelete(superseded.map((entry) => entry.id));

    await db.inboxItems.delete(id);

    await db.outbox.add({
      id: crypto.randomUUID(),
      entity: "inbox_item",
      operation: "delete",
      entityId: id,
      idempotencyKey: crypto.randomUUID(),
      baseVersion: local.version,
      payload: {},
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
      sequence: nextMutationSequence(),
    });
  });
}
