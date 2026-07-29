import { and, desc, eq, isNull } from "drizzle-orm";

import type { InboxCaptureRequest, InboxPatch } from "@/domain/inbox/capture";
import type { Database } from "@/server/db/connection";
import { inboxItem, inboxItemTombstone } from "@/server/db/schema";

export interface InboxItemRecord {
  id: string;
  title: string;
  seenAt: Date | null;
  version: number;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const recordColumns = {
  id: inboxItem.id,
  title: inboxItem.title,
  seenAt: inboxItem.seenAt,
  version: inboxItem.version,
  idempotencyKey: inboxItem.idempotencyKey,
  createdAt: inboxItem.createdAt,
  updatedAt: inboxItem.updatedAt,
};

/** The fields an update writes, plus the bookkeeping the service supplies. */
export interface InboxUpdateWrite {
  patch: InboxPatch;
  seenAt: Date | null;
  version: number;
  idempotencyKey: string;
}

/**
 * Account-scoped access to Inbox Items and their deletion tombstones. Every
 * operation is keyed by `userId`, so a caller can only ever read or write its
 * own account's captures. Foreign keys and these ownership predicates are what
 * enforce tenancy.
 */
export function createInboxRepository(database: Database) {
  return {
    async getById(userId: string, id: string): Promise<InboxItemRecord | null> {
      const [row] = await database
        .select(recordColumns)
        .from(inboxItem)
        .where(and(eq(inboxItem.userId, userId), eq(inboxItem.id, id)))
        .limit(1);

      return row ?? null;
    },

    async isTombstoned(userId: string, id: string): Promise<boolean> {
      const [row] = await database
        .select({ id: inboxItemTombstone.id })
        .from(inboxItemTombstone)
        .where(
          and(
            eq(inboxItemTombstone.userId, userId),
            eq(inboxItemTombstone.id, id),
          ),
        )
        .limit(1);

      return row !== undefined;
    },

    async insert(
      userId: string,
      input: InboxCaptureRequest,
    ): Promise<InboxItemRecord> {
      const [row] = await database
        .insert(inboxItem)
        .values({
          id: input.id,
          userId,
          title: input.title,
          idempotencyKey: input.idempotencyKey,
        })
        .returning(recordColumns);

      return row;
    },

    async update(
      userId: string,
      id: string,
      write: InboxUpdateWrite,
    ): Promise<InboxItemRecord> {
      const [row] = await database
        .update(inboxItem)
        .set({
          seenAt: write.seenAt,
          version: write.version,
          idempotencyKey: write.idempotencyKey,
          updatedAt: new Date(),
        })
        .where(and(eq(inboxItem.userId, userId), eq(inboxItem.id, id)))
        .returning(recordColumns);

      return row;
    },

    /** Deletes the Inbox Item and records a tombstone in one transaction. */
    async remove(userId: string, id: string): Promise<void> {
      await database.transaction(async (tx) => {
        await tx
          .delete(inboxItem)
          .where(and(eq(inboxItem.userId, userId), eq(inboxItem.id, id)));
        await tx
          .insert(inboxItemTombstone)
          .values({ id, userId })
          .onConflictDoNothing();
      });
    },

    async listForAccount(userId: string): Promise<InboxItemRecord[]> {
      return database
        .select(recordColumns)
        .from(inboxItem)
        .where(
          and(eq(inboxItem.userId, userId), isNull(inboxItem.classifiedAt)),
        )
        .orderBy(desc(inboxItem.createdAt), desc(inboxItem.id));
    },
  };
}

export type InboxRepository = ReturnType<typeof createInboxRepository>;
