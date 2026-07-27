import Dexie, { type Table } from "dexie";

import type { EventOrigin, EventStatus } from "@/domain/event/event";
import type { TaskStatus } from "@/domain/task/task";

/**
 * Dexie/IndexedDB owns the durable local replica for offline-capable domain
 * entities and the mutation outbox. `useLiveQuery` exposes optimistic changes
 * to React immediately, and a single command layer atomically updates an
 * entity together with its outbox record. TanStack Query must never
 * independently own the state of an entity that lives here.
 */

export type SyncState = "pending" | "synced" | "failed" | "conflict";

/** An Inbox Item as the client holds it, including its local sync status. */
export interface LocalInboxItem {
  id: string;
  title: string;
  seen: boolean;
  version: number;
  createdAt: string;
  syncState: SyncState;
  classifiedAt?: string;
}

/**
 * A Task as the client holds it. `version` tracks the last server-confirmed
 * version so an update can carry a correct base version. `deletedAt` marks an
 * optimistic deletion during its 10-second Undo window; the row is only removed
 * from the replica once the deletion finalizes and its outbox entry is queued.
 */
export interface LocalTask {
  id: string;
  title: string;
  status: TaskStatus;
  completedAt: string | null;
  version: number;
  createdAt: string;
  deletedAt: string | null;
  syncState: SyncState;
}

/**
 * An Event as the client holds it. Start and end are exact instants with their
 * IANA time zones, mirroring Google-compatible semantics; `isAllDay`,
 * recurrence identity, and `status` are carried so an imported Event and a local
 * Event share one shape even though local creation is timed-only. `origin`
 * distinguishes a synchronized Google Event from a local one, and together with
 * `syncState` drives the agenda's stale/pending/synchronized cues. `deletedAt`
 * marks an optimistic deletion during its 10-second Undo window.
 */
export interface LocalEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  startTimeZone: string;
  endTimeZone: string;
  isAllDay: boolean;
  recurringEventId: string | null;
  status: EventStatus;
  origin: EventOrigin;
  version: number;
  createdAt: string;
  deletedAt: string | null;
  syncState: SyncState;
}

export interface LocalThought {
  id: string;
  title: string;
  body: string;
  sourceInboxItemId: string | null;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncState: SyncState;
}

/** Which durable entity a table (and its outbox entries) belongs to. */
export type SyncEntity = "inbox_item" | "task" | "thought" | "event";

export type OutboxOperation = "create" | "update" | "delete";
export type OutboxStatus = "pending" | "failed";

/**
 * One durable, replayable mutation. It carries the idempotency key and base
 * version that make server retries safe: the same entry can be delivered any
 * number of times without creating duplicates or clobbering newer data.
 */
export interface OutboxEntry {
  id: string;
  entity: SyncEntity;
  operation: OutboxOperation;
  entityId: string;
  idempotencyKey: string;
  baseVersion: number | null;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sequence?: number;
}

export class RailsDatabase extends Dexie {
  inboxItems!: Table<LocalInboxItem, string>;
  tasks!: Table<LocalTask, string>;
  thoughts!: Table<LocalThought, string>;
  events!: Table<LocalEvent, string>;
  outbox!: Table<OutboxEntry, string>;

  constructor(name = "rails") {
    super(name);
    this.version(1).stores({
      inboxItems: "id, createdAt, syncState",
      outbox: "id, entity, status, createdAt",
    });
    this.version(2).stores({
      inboxItems: "id, createdAt, syncState",
      tasks: "id, status, createdAt, deletedAt, syncState",
      outbox: "id, entity, status, createdAt",
    });
    this.version(3).stores({
      inboxItems: "id, createdAt, syncState",
      tasks: "id, status, createdAt, deletedAt, syncState",
      thoughts: "id, createdAt, updatedAt, deletedAt, syncState",
      outbox: "id, entity, status, sequence, createdAt",
    });
    // `startAt` is indexed so the weekly agenda can range-scan the current week
    // directly; `deletedAt` supports the optimistic-deletion Undo window.
    this.version(4).stores({
      inboxItems: "id, createdAt, syncState",
      tasks: "id, status, createdAt, deletedAt, syncState",
      thoughts: "id, createdAt, updatedAt, deletedAt, syncState",
      events: "id, startAt, deletedAt, syncState",
      outbox: "id, entity, status, sequence, createdAt",
    });
  }
}

const databases = new Map<string, RailsDatabase>();

/**
 * The process-wide client database. Only constructed in the browser, where
 * IndexedDB exists; server and unit-test callers pass their own instance.
 */
export function getClientDatabase(accountId: string): RailsDatabase {
  const name = `rails:${accountId}`;
  const existing = databases.get(name);
  if (existing) return existing;
  const database = new RailsDatabase(name);
  databases.set(name, database);
  return database;
}
