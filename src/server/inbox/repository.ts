import { and, desc, eq } from "drizzle-orm";

import type { InboxCaptureRequest } from "@/domain/inbox/capture";
import type { Database } from "@/server/db/connection";
import { inboxItem } from "@/server/db/schema";

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

/**
 * Account-scoped access to Inbox Items. Every operation is keyed by `userId`,
 * so a caller can only ever read or write its own account's captures. Foreign
 * keys and these ownership predicates are what enforce tenancy.
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

    async listForAccount(userId: string): Promise<InboxItemRecord[]> {
      return database
        .select(recordColumns)
        .from(inboxItem)
        .where(eq(inboxItem.userId, userId))
        .orderBy(desc(inboxItem.createdAt), desc(inboxItem.id));
    },
  };
}

export type InboxRepository = ReturnType<typeof createInboxRepository>;
