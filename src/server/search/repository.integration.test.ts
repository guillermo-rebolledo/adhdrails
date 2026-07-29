import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseConnection } from "@/server/db/client";
import { inboxItem, task, thought, user } from "@/server/db/schema";

import { createSearchRepository } from "./repository";

const DATABASE_URL = process.env.DATABASE_URL;
const USERS = ["search-owner", "search-neighbor"];
const IDS = {
  task: "71000000-0000-4000-8000-000000000001",
  thought: "72000000-0000-4000-8000-000000000001",
  inbox: "73000000-0000-4000-8000-000000000001",
  neighbor: "74000000-0000-4000-8000-000000000001",
} as const;
const connection = DATABASE_URL
  ? createDatabaseConnection(DATABASE_URL)
  : undefined;

describe.skipIf(!connection)("Search repository PostgreSQL integration", () => {
  beforeAll(async () => {
    await connection!.database
      .insert(user)
      .values(
        USERS.map((id) => ({ id, name: id, email: `${id}@example.test` })),
      );
    await connection!.database.insert(task).values([
      {
        id: IDS.task,
        userId: USERS[0],
        title: "Quarterly planning report",
        notes: "Draft the executive summary",
        idempotencyKey: crypto.randomUUID(),
      },
      {
        id: IDS.neighbor,
        userId: USERS[1],
        title: "Quarterly planning secrets",
        notes: "Must never cross accounts",
        idempotencyKey: crypto.randomUUID(),
      },
    ]);
    await connection!.database.insert(thought).values({
      id: IDS.thought,
      userId: USERS[0],
      title: "Reporting outline",
      body: "Planning notes for the charts",
      lastMutationKey: crypto.randomUUID(),
    });
    await connection!.database.insert(inboxItem).values({
      id: IDS.inbox,
      userId: USERS[0],
      title: "Ask Sam about planning",
      idempotencyKey: crypto.randomUUID(),
    });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.database.delete(user).where(inArray(user.id, USERS));
    await connection.close();
  });

  it("ranks full-text, partial, and typo-tolerant matches without leaking another account", async () => {
    const repository = createSearchRepository(connection!.database);

    const fullText = await repository.search(USERS[0], "planning");
    const typo = await repository.search(USERS[0], "quaterly");

    expect(fullText.items.map((item) => item.id)).toEqual([
      IDS.inbox,
      IDS.task,
      IDS.thought,
    ]);
    expect(typo.items[0]).toMatchObject({
      id: IDS.task,
      type: "task",
      href: `/tasks/${IDS.task}/edit`,
    });
    expect(fullText.items).not.toContainEqual(
      expect.objectContaining({ id: IDS.neighbor }),
    );
  });

  it("bounds result pages and continues from an opaque rank cursor", async () => {
    const repository = createSearchRepository(connection!.database);

    const first = await repository.search(USERS[0], "planning", undefined, 2);
    const second = await repository.search(
      USERS[0],
      "planning",
      first.nextCursor ?? undefined,
      2,
    );

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(second.nextCursor).toBeNull();
  });

  it("installs the GIN indexes that protect full-text and trigram search", async () => {
    const indexes = await connection!.database.execute<{
      indexname: string;
    }>(sql`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'task_search_fts_idx',
          'task_search_trgm_idx',
          'thought_search_fts_idx',
          'thought_search_trgm_idx',
          'inbox_item_search_fts_idx',
          'inbox_item_search_trgm_idx'
        )
      order by indexname
    `);

    expect(indexes.map(({ indexname }) => indexname)).toEqual([
      "inbox_item_search_fts_idx",
      "inbox_item_search_trgm_idx",
      "task_search_fts_idx",
      "task_search_trgm_idx",
      "thought_search_fts_idx",
      "thought_search_trgm_idx",
    ]);
  });

  it("uses the trigram index for typo-tolerant word matching", async () => {
    await connection!.database.transaction(async (transaction) => {
      await transaction.execute(sql`set local enable_seqscan = off`);
      const plan = await transaction.execute<{ "QUERY PLAN": string }>(sql`
        explain
        select id
        from task
        where lower('quaterly') <<% lower(title || ' ' || notes)
      `);

      expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
        "task_search_trgm_idx",
      );
    });
  });
});
