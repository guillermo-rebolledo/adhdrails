import { reconcilers } from "./entities";
import type { OutboxEntry, RailsDatabase } from "./db";

/**
 * Outcome of delivering one outbox entry to the server:
 * - `ok` — the server confirmed the mutation; reconcile and drop the entry.
 *   `item` carries the server record for a create/update and is absent for a
 *   delete.
 * - `conflict` — the server has divergent data; keep the local change and mark
 *   it for review rather than discarding it.
 * - `gone` — the record was deleted and tombstoned; drop the local copy and the
 *   entry so a queued mutation never resurrects it.
 * - `retry` — a transient failure (offline, network, 5xx); leave the entry
 *   pending so a later drain can try again.
 */
export type SendResult =
  | { ok: true; item?: unknown }
  | { ok: false; kind: "conflict"; current: unknown }
  | { ok: false; kind: "gone" }
  | { ok: false; kind: "retry"; message: string };

export interface SyncDeps {
  db: RailsDatabase;
  send: (entry: OutboxEntry) => Promise<SendResult>;
  isOnline?: () => boolean;
  afterSync?: () => Promise<void>;
}

/**
 * How many transient send failures a queued entry tolerates before its item is
 * surfaced as failed. The entry stays queued and keeps retrying (e.g. on the
 * next reconnect); the state is a signal to the user, not an abandonment.
 */
export const MAX_SEND_ATTEMPTS = 5;

async function reconcileSuccess(
  db: RailsDatabase,
  entry: OutboxEntry,
  item: unknown,
): Promise<void> {
  const reconciler = reconcilers[entry.entity];
  await db.transaction("rw", db.tables, async () => {
    if (entry.operation === "delete") {
      await reconciler.removeLocal(db, entry.entityId);
    } else if (item) {
      await reconciler.applyServer(
        db,
        entry.entityId,
        item as Record<string, unknown>,
      );
    }
    await db.outbox.delete(entry.id);
  });
}

async function reconcileConflict(
  db: RailsDatabase,
  entry: OutboxEntry,
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    await reconcilers[entry.entity].markState(db, entry.entityId, "conflict");
    await db.outbox.update(entry.id, {
      status: "failed",
      attempts: entry.attempts + 1,
      lastError: "conflict",
    });
  });
}

async function reconcileGone(
  db: RailsDatabase,
  entry: OutboxEntry,
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    await reconcilers[entry.entity].removeLocal(db, entry.entityId);
    await db.outbox.delete(entry.id);
  });
}

async function recordRetry(
  db: RailsDatabase,
  entry: OutboxEntry,
  message: string,
): Promise<void> {
  const attempts = entry.attempts + 1;

  await db.transaction("rw", db.tables, async () => {
    // The entry stays pending so a later drain retries it.
    await db.outbox.update(entry.id, { attempts, lastError: message });

    if (attempts >= MAX_SEND_ATTEMPTS) {
      await reconcilers[entry.entity].markState(db, entry.entityId, "failed");
    }
  });
}

/**
 * Delivers every pending outbox entry once, oldest first, reconciling the local
 * replica against each result. Failed (conflict) entries are left alone; a
 * transient failure keeps the entry pending for the next drain.
 */
export async function drainOutbox(deps: SyncDeps): Promise<void> {
  if (deps.isOnline && !deps.isOnline()) {
    return;
  }

  const pending = await deps.db.outbox
    .where("status")
    .equals("pending")
    .toArray();
  pending.sort(
    (left, right) =>
      (left.sequence ?? Date.parse(left.createdAt)) -
      (right.sequence ?? Date.parse(right.createdAt)),
  );

  for (const entry of pending) {
    const result = await deps.send(entry);

    if (result.ok) {
      await reconcileSuccess(deps.db, entry, result.item);
    } else if (result.kind === "conflict") {
      await reconcileConflict(deps.db, entry);
    } else if (result.kind === "gone") {
      await reconcileGone(deps.db, entry);
    } else {
      await recordRetry(deps.db, entry, result.message);
    }
  }
}

export interface SyncEngine {
  sync: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

/**
 * Drives the outbox: an initial drain, another whenever connectivity returns,
 * and an on-demand `sync` the UI calls right after a mutation. Drains never
 * overlap; a request that arrives mid-drain queues one more pass.
 */
export function createSyncEngine(deps: SyncDeps): SyncEngine {
  let inFlight: Promise<void> | null = null;
  let queued = false;

  async function run(): Promise<void> {
    if (inFlight) {
      queued = true;
      return inFlight;
    }

    inFlight = (async () => {
      try {
        do {
          queued = false;
          await drainOutbox(deps);
          await deps.afterSync?.();
        } while (queued);
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  const onOnline = () => {
    void run();
  };

  return {
    sync: run,
    start() {
      if (typeof window !== "undefined") {
        window.addEventListener("online", onOnline);
      }
      void run();
    },
    stop() {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
      }
    },
  };
}
