import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseConnection } from "@/server/db/client";
import { task, user } from "@/server/db/schema";

import { createTaskRepository } from "./repository";
import { createTaskService } from "./service";

const DATABASE_URL = process.env.DATABASE_URL;
const USER_IDS = ["cursor-owner", "cursor-neighbor"];
const CREATED_AT = new Date("2026-07-27T10:00:00.000Z");

const IDS = {
  first: "10000000-0000-4000-8000-000000000001",
  insertedBefore: "20000000-0000-4000-8000-000000000002",
  second: "30000000-0000-4000-8000-000000000003",
  insertedAfter: "40000000-0000-4000-8000-000000000004",
  third: "50000000-0000-4000-8000-000000000005",
  neighbor: "60000000-0000-4000-8000-000000000006",
} as const;

const connection = DATABASE_URL
  ? createDatabaseConnection(DATABASE_URL)
  : undefined;

describe.skipIf(!connection)("Task repository PostgreSQL integration", () => {
  beforeAll(async () => {
    await connection!.database.insert(user).values(
      USER_IDS.map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
      })),
    );
    await connection!.database.insert(task).values([
      {
        id: IDS.first,
        userId: USER_IDS[0],
        title: "First",
        idempotencyKey: crypto.randomUUID(),
        createdAt: CREATED_AT,
        scheduledDate: "2026-07-27",
        energy: "high",
      },
      {
        id: IDS.second,
        userId: USER_IDS[0],
        title: "Second",
        idempotencyKey: crypto.randomUUID(),
        createdAt: CREATED_AT,
      },
      {
        id: IDS.third,
        userId: USER_IDS[0],
        title: "Third",
        idempotencyKey: crypto.randomUUID(),
        createdAt: CREATED_AT,
      },
      {
        id: IDS.neighbor,
        userId: USER_IDS[1],
        title: "Another account",
        idempotencyKey: crypto.randomUUID(),
        createdAt: CREATED_AT,
      },
    ]);
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.database.delete(user).where(inArray(user.id, USER_IDS));
    await connection.close();
  });

  it("keeps a compound cursor stable across timestamp ties and concurrent inserts", async () => {
    const service = createTaskService(
      createTaskRepository(connection!.database),
    );
    const firstPage = await service.listCollection(
      USER_IDS[0],
      { collection: "anytime", today: "2026-07-27" },
      2,
    );

    expect(firstPage).toMatchObject({
      ok: true,
      items: [{ id: IDS.first }, { id: IDS.second }],
      nextCursor: expect.any(String),
    });
    if (!firstPage.ok) throw new Error("Expected a valid first page.");

    await connection!.database.insert(task).values([
      {
        id: IDS.insertedBefore,
        userId: USER_IDS[0],
        title: "Inserted before cursor",
        idempotencyKey: crypto.randomUUID(),
        createdAt: CREATED_AT,
      },
      {
        id: IDS.insertedAfter,
        userId: USER_IDS[0],
        title: "Inserted after cursor",
        idempotencyKey: crypto.randomUUID(),
        createdAt: CREATED_AT,
      },
    ]);

    const secondPage = await service.listCollection(
      USER_IDS[0],
      {
        collection: "anytime",
        today: "2026-07-27",
        cursor: firstPage.nextCursor,
      },
      2,
    );

    expect(secondPage).toMatchObject({
      ok: true,
      items: [{ id: IDS.insertedAfter }, { id: IDS.third }],
      nextCursor: null,
    });
    if (!secondPage.ok) throw new Error("Expected a valid second page.");

    const previousPage = await service.listCollection(
      USER_IDS[0],
      {
        collection: "anytime",
        today: "2026-07-27",
        cursor: secondPage.previousCursor,
        direction: "backward",
      },
      2,
    );

    expect(previousPage).toMatchObject({
      ok: true,
      items: [{ id: IDS.insertedBefore }, { id: IDS.second }],
      previousCursor: expect.any(String),
    });
  });

  it("keeps fixed Today commitments visible regardless of Energy", async () => {
    const service = createTaskService(
      createTaskRepository(connection!.database),
    );

    const today = await service.listCollection(USER_IDS[0], {
      collection: "today",
      today: "2026-07-27",
      energy: "low",
    });

    expect(today).toMatchObject({
      ok: true,
      items: [{ id: IDS.first, energy: "high" }],
    });
  });
});
