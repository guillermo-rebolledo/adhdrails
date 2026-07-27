import type { EventOrigin, EventStatus } from "@/domain/event/event";
import type { TaskStatus } from "@/domain/task/task";

import type { RailsDatabase, SyncEntity, SyncState } from "./db";

/**
 * How the sync engine reconciles one entity's local replica against server
 * results. Each method runs inside the ambient Dexie transaction the engine
 * opens, so an entity change and its outbox mutation commit atomically. This
 * registry is the single place that knows how a synced record maps onto the
 * local shape — the engine itself stays entity-agnostic.
 */
export interface EntityReconciler {
  /** Apply a server-confirmed record after a successful create or update. */
  applyServer(
    db: RailsDatabase,
    entityId: string,
    server: Record<string, unknown>,
  ): Promise<void>;
  /** Remove the local row entirely (a confirmed delete or a tombstoned id). */
  removeLocal(db: RailsDatabase, entityId: string): Promise<void>;
  /**
   * Mark an unsynced local row's state (conflict or failed) for review. A row
   * already reconciled as synced is left untouched.
   */
  markState(
    db: RailsDatabase,
    entityId: string,
    state: SyncState,
  ): Promise<void>;
}

const inboxReconciler: EntityReconciler = {
  async applyServer(db, entityId, server) {
    const local = await db.inboxItems.get(entityId);
    if (local) {
      await db.inboxItems.put({
        ...local,
        title: server.title as string,
        seen: server.seen as boolean,
        version: server.version as number,
        syncState: "synced",
      });
    }
  },
  async removeLocal(db, entityId) {
    await db.inboxItems.delete(entityId);
  },
  async markState(db, entityId, state) {
    const local = await db.inboxItems.get(entityId);
    if (local && local.syncState !== "synced") {
      await db.inboxItems.put({ ...local, syncState: state });
    }
  },
};

const taskReconciler: EntityReconciler = {
  async applyServer(db, entityId, server) {
    const local = await db.tasks.get(entityId);
    if (local) {
      await db.tasks.put({
        ...local,
        title: server.title as string,
        status: server.status as TaskStatus,
        completedAt: (server.completedAt as string | null) ?? null,
        version: server.version as number,
        syncState: "synced",
      });
    }
  },
  async removeLocal(db, entityId) {
    await db.tasks.delete(entityId);
  },
  async markState(db, entityId, state) {
    const local = await db.tasks.get(entityId);
    if (local && local.syncState !== "synced") {
      await db.tasks.put({ ...local, syncState: state });
    }
  },
};

const thoughtReconciler: EntityReconciler = {
  async applyServer(db, entityId, server) {
    const local = await db.thoughts.get(entityId);
    if (!local) return;
    const serverVersion = server.version as number;
    if (local.version === serverVersion) {
      await db.thoughts.put({
        id: server.id as string,
        title: server.title as string,
        body: server.body as string,
        sourceInboxItemId: (server.sourceInboxItemId as string | null) ?? null,
        version: serverVersion,
        deletedAt: (server.deletedAt as string | null) ?? null,
        createdAt: server.createdAt as string,
        updatedAt: server.updatedAt as string,
        syncState: "synced",
      });
    }
  },
  async removeLocal(db, entityId) {
    await db.thoughts.delete(entityId);
  },
  async markState(db, entityId, state) {
    const local = await db.thoughts.get(entityId);
    if (local && local.syncState !== "synced") {
      await db.thoughts.put({ ...local, syncState: state });
    }
  },
};

const eventReconciler: EntityReconciler = {
  async applyServer(db, entityId, server) {
    const local = await db.events.get(entityId);
    if (local) {
      await db.events.put({
        ...local,
        title: server.title as string,
        startAt: server.startAt as string,
        endAt: server.endAt as string,
        startTimeZone: server.startTimeZone as string,
        endTimeZone: server.endTimeZone as string,
        isAllDay: server.isAllDay as boolean,
        recurringEventId: (server.recurringEventId as string | null) ?? null,
        status: server.status as EventStatus,
        origin: server.origin as EventOrigin,
        version: server.version as number,
        syncState: "synced",
      });
    }
  },
  async removeLocal(db, entityId) {
    await db.events.delete(entityId);
  },
  async markState(db, entityId, state) {
    const local = await db.events.get(entityId);
    if (local && local.syncState !== "synced") {
      await db.events.put({ ...local, syncState: state });
    }
  },
};

export const reconcilers: Record<SyncEntity, EntityReconciler> = {
  inbox_item: inboxReconciler,
  task: taskReconciler,
  thought: thoughtReconciler,
  event: eventReconciler,
};
