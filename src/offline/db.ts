import Dexie, { type Table } from "dexie";

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

export type OutboxOperation = "create";
export type OutboxStatus = "pending" | "failed";

/**
 * One durable, replayable mutation. It carries the idempotency key and base
 * version that make server retries safe: the same entry can be delivered any
 * number of times without creating duplicates or clobbering newer data.
 */
export interface OutboxEntry {
  id: string;
  entity: "inbox_item";
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
  outbox!: Table<OutboxEntry, string>;

  constructor(name = "rails") {
    super(name);
    this.version(1).stores({
      inboxItems: "id, createdAt, syncState",
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
