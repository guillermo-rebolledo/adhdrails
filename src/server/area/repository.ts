import { and, asc, eq } from "drizzle-orm";

import type { AreaCreateRequest } from "@/domain/area/area";
import type { Database } from "@/server/db/connection";
import { area } from "@/server/db/schema";

export interface AreaRecord {
  id: string;
  name: string;
  version: number;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const recordColumns = {
  id: area.id,
  name: area.name,
  version: area.version,
  idempotencyKey: area.idempotencyKey,
  createdAt: area.createdAt,
  updatedAt: area.updatedAt,
};

/**
 * Account-scoped access to Areas. Every operation is keyed by `userId`, so a
 * caller can only ever read or write its own account's Areas. Areas are
 * create-and-list only in the MVP — there is no rename or delete path.
 */
export function createAreaRepository(database: Database) {
  return {
    async getById(userId: string, id: string): Promise<AreaRecord | null> {
      const [row] = await database
        .select(recordColumns)
        .from(area)
        .where(and(eq(area.userId, userId), eq(area.id, id)))
        .limit(1);

      return row ?? null;
    },

    async insert(
      userId: string,
      input: AreaCreateRequest,
    ): Promise<AreaRecord> {
      const [row] = await database
        .insert(area)
        .values({
          id: input.id,
          userId,
          name: input.name,
          idempotencyKey: input.idempotencyKey,
        })
        .returning(recordColumns);

      return row;
    },

    async listForAccount(userId: string): Promise<AreaRecord[]> {
      return database
        .select(recordColumns)
        .from(area)
        .where(eq(area.userId, userId))
        .orderBy(asc(area.name), asc(area.id));
    },
  };
}

export type AreaRepository = ReturnType<typeof createAreaRepository>;
