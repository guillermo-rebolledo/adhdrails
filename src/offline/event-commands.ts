import {
  addMinutesToInstant,
  DEFAULT_EVENT_DURATION_MINUTES,
} from "@/domain/calendar/agenda";
import {
  eventCreateRequestSchema,
  type EventPatch,
} from "@/domain/event/event";

import type { LocalEvent, OutboxEntry, RailsDatabase } from "./db";

export interface CreateEventInput {
  title: string;
  /** The exact start instant as an ISO-8601 string. */
  startAt: string;
  /** The IANA time zone the Event was scheduled in. */
  timeZone: string;
  /** Defaults to the 30-minute Event duration when omitted. */
  durationMinutes?: number;
}

export interface CreateEventOptions {
  id?: string;
  idempotencyKey?: string;
  outboxId?: string;
  now?: string;
}

/**
 * Creates a local timed Event. The end defaults to 30 minutes after the start,
 * matching the MVP's fast-entry default. In one atomic Dexie transaction it
 * writes the optimistic local Event and its create outbox entry, so the Event is
 * never acknowledged locally without a durable instruction to synchronize it.
 * The client-generated id becomes the server id, so the record never needs
 * temporary-ID remapping. Local Events are timed, confirmed, and non-recurring;
 * all-day and recurring Events arrive only through Google import.
 */
export async function createEvent(
  db: RailsDatabase,
  input: CreateEventInput,
  options: CreateEventOptions = {},
): Promise<LocalEvent> {
  const id = options.id ?? crypto.randomUUID();
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const createdAt = options.now ?? new Date().toISOString();
  const endAt = addMinutesToInstant(
    input.startAt,
    input.durationMinutes ?? DEFAULT_EVENT_DURATION_MINUTES,
  );

  const request = eventCreateRequestSchema.parse({
    id,
    title: input.title,
    startAt: input.startAt,
    endAt,
    startTimeZone: input.timeZone,
    endTimeZone: input.timeZone,
    idempotencyKey,
  });

  const event: LocalEvent = {
    id,
    title: request.title,
    startAt: request.startAt,
    endAt: request.endAt,
    startTimeZone: request.startTimeZone,
    endTimeZone: request.endTimeZone,
    isAllDay: false,
    recurringEventId: null,
    status: "confirmed",
    origin: "local",
    version: 1,
    createdAt,
    deletedAt: null,
    syncState: "pending",
  };

  const entry: OutboxEntry = {
    id: options.outboxId ?? crypto.randomUUID(),
    entity: "event",
    operation: "create",
    entityId: id,
    idempotencyKey,
    baseVersion: null,
    payload: request,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt,
  };

  await db.transaction("rw", db.events, db.outbox, async () => {
    await db.events.add(event);
    await db.outbox.add(entry);
  });

  return event;
}

export interface UpdateEventOptions {
  idempotencyKey?: string;
  outboxId?: string;
  now?: string;
}

/**
 * Applies an edit to a local Event and queues its delivery. The outbox entry
 * carries the last server-confirmed `version` as its base version, so the
 * server can detect a stale write. Repeated pending edits to the same Event
 * coalesce into one entry (keeping the original base version) rather than racing
 * each other to the server.
 */
export async function updateEvent(
  db: RailsDatabase,
  id: string,
  patch: EventPatch,
  options: UpdateEventOptions = {},
): Promise<void> {
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const now = options.now ?? new Date().toISOString();

  await db.transaction("rw", db.events, db.outbox, async () => {
    const local = await db.events.get(id);
    if (!local) {
      return;
    }

    const updated: LocalEvent = {
      ...local,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
      ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}),
      ...(patch.startTimeZone !== undefined
        ? { startTimeZone: patch.startTimeZone }
        : {}),
      ...(patch.endTimeZone !== undefined
        ? { endTimeZone: patch.endTimeZone }
        : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      syncState: "pending",
    };
    await db.events.put(updated);

    const [pending] = await db.outbox
      .filter(
        (entry) =>
          entry.entityId === id &&
          entry.operation === "update" &&
          entry.status === "pending",
      )
      .toArray();

    if (pending) {
      const previousPatch = (pending.payload.patch ?? {}) as EventPatch;
      const mergedPatch = { ...previousPatch, ...patch };
      await db.outbox.update(pending.id, {
        payload: { ...pending.payload, patch: mergedPatch },
      });
      return;
    }

    const entry: OutboxEntry = {
      id: options.outboxId ?? crypto.randomUUID(),
      entity: "event",
      operation: "update",
      entityId: id,
      idempotencyKey,
      baseVersion: local.version,
      payload: { idempotencyKey, baseVersion: local.version, patch },
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: now,
    };
    await db.outbox.add(entry);
  });
}

/**
 * Begins an app-owned deletion: the Event is hidden optimistically by stamping
 * `deletedAt`, but nothing is sent yet. The 10-second Undo window is the UI's
 * responsibility; {@link restoreEvent} reverses this, {@link finalizeEventDeletion}
 * commits it.
 */
export async function deleteEventLocally(
  db: RailsDatabase,
  id: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  await db.events.update(id, { deletedAt: now });
}

/** Reverses a pending deletion within the Undo window. */
export async function restoreEvent(
  db: RailsDatabase,
  id: string,
): Promise<void> {
  await db.events.update(id, { deletedAt: null });
}

export interface FinalizeDeletionOptions {
  idempotencyKey?: string;
  outboxId?: string;
  now?: string;
}

/**
 * Commits an app-owned deletion once the Undo window elapses. It removes the
 * local row and any superseded pending mutations for the Event, then queues one
 * idempotent delete. The server delete writes a 30-day tombstone that prevents a
 * queued create or update from resurrecting the Event.
 */
export async function finalizeEventDeletion(
  db: RailsDatabase,
  id: string,
  options: FinalizeDeletionOptions = {},
): Promise<void> {
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const now = options.now ?? new Date().toISOString();

  await db.transaction("rw", db.events, db.outbox, async () => {
    const local = await db.events.get(id);
    const baseVersion = local?.version ?? null;

    const superseded = await db.outbox
      .filter((entry) => entry.entityId === id)
      .toArray();
    await db.outbox.bulkDelete(superseded.map((entry) => entry.id));

    await db.events.delete(id);

    const entry: OutboxEntry = {
      id: options.outboxId ?? crypto.randomUUID(),
      entity: "event",
      operation: "delete",
      entityId: id,
      idempotencyKey,
      baseVersion,
      payload: {},
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: now,
    };
    await db.outbox.add(entry);
  });
}
