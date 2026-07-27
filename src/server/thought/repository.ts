import { and, desc, eq, lt, sql } from "drizzle-orm";

import type {
  ThoughtCreateRequest,
  ThoughtDeletionRequest,
  ThoughtMutationRequest,
} from "@/domain/thought/thought";
import type { Database } from "@/server/db/connection";
import { inboxItem, thought } from "@/server/db/schema";

export interface ThoughtRecord {
  id: string;
  title: string;
  body: string;
  sourceInboxItemId: string | null;
  version: number;
  lastMutationKey: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const columns = {
  id: thought.id,
  title: thought.title,
  body: thought.body,
  sourceInboxItemId: thought.sourceInboxItemId,
  version: thought.version,
  lastMutationKey: thought.lastMutationKey,
  deletedAt: thought.deletedAt,
  createdAt: thought.createdAt,
  updatedAt: thought.updatedAt,
};

export function createThoughtRepository(database: Database) {
  return {
    async getById(userId: string, id: string): Promise<ThoughtRecord | null> {
      const [row] = await database
        .select(columns)
        .from(thought)
        .where(and(eq(thought.userId, userId), eq(thought.id, id)))
        .limit(1);
      return row ?? null;
    },

    async insert(
      userId: string,
      input: ThoughtCreateRequest,
    ): Promise<ThoughtRecord> {
      return database.transaction(async (transaction) => {
        const [row] = await transaction
          .insert(thought)
          .values({
            id: input.id,
            userId,
            title: input.title,
            body: input.body,
            sourceInboxItemId: input.sourceInboxItemId,
            lastMutationKey: input.idempotencyKey,
          })
          .returning(columns);
        if (input.sourceInboxItemId) {
          await transaction
            .update(inboxItem)
            .set({ classifiedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(inboxItem.userId, userId),
                eq(inboxItem.id, input.sourceInboxItemId),
              ),
            );
        }
        return row;
      });
    },

    async listForAccount(userId: string): Promise<ThoughtRecord[]> {
      return database
        .select(columns)
        .from(thought)
        .where(eq(thought.userId, userId))
        .orderBy(desc(thought.updatedAt), desc(thought.id))
        .limit(100);
    },

    async purgeDeletedBefore(userId: string, cutoff: Date): Promise<void> {
      await database
        .delete(thought)
        .where(and(eq(thought.userId, userId), lt(thought.deletedAt, cutoff)));
    },

    async mutate(
      userId: string,
      id: string,
      input: ThoughtMutationRequest | ThoughtDeletionRequest,
    ): Promise<ThoughtRecord | null> {
      const values =
        "deleted" in input
          ? {
              deletedAt: input.deleted ? new Date() : null,
              lastMutationKey: input.idempotencyKey,
              version: sql`${thought.version} + 1`,
              updatedAt: new Date(),
            }
          : {
              title: input.title,
              body: input.body,
              lastMutationKey: input.idempotencyKey,
              version: sql`${thought.version} + 1`,
              updatedAt: new Date(),
            };
      const [row] = await database
        .update(thought)
        .set(values)
        .where(
          and(
            eq(thought.userId, userId),
            eq(thought.id, id),
            eq(thought.version, input.baseVersion),
          ),
        )
        .returning(columns);
      return row ?? null;
    },
  };
}

export type ThoughtRepository = ReturnType<typeof createThoughtRepository>;
