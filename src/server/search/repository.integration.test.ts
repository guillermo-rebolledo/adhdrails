import { inArray } from "drizzle-orm";
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

    const fullText = await repository.search(USERS[0], "planning report");
    const typo = await repository.search(USERS[0], "quaterly");

    expect(fullText.items.map((item) => item.id)).toEqual([
      IDS.task,
      IDS.thought,
      IDS.inbox,
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
});
