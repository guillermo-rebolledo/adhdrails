import Dexie, { type Table } from "dexie";

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

/** Which durable entity a table (and its outbox entries) belongs to. */
export type SyncEntity = "inbox_item" | "task";

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
}

export class RailsDatabase extends Dexie {
  inboxItems!: Table<LocalInboxItem, string>;
  tasks!: Table<LocalTask, string>;
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
  }
}

let cached: RailsDatabase | null = null;

/**
 * The process-wide client database. Only constructed in the browser, where
 * IndexedDB exists; server and unit-test callers pass their own instance.
 */
export function getClientDatabase(): RailsDatabase {
  cached ??= new RailsDatabase();
  return cached;
}
