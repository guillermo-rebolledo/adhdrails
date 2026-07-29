import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { getClientDatabase, type RailsDatabase } from "./db";

const opened: RailsDatabase[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.delete()));
});

describe("account-scoped client database", () => {
  it("keeps two accounts in separate IndexedDB databases", async () => {
    const first = getClientDatabase(`first-${crypto.randomUUID()}`);
    const second = getClientDatabase(`second-${crypto.randomUUID()}`);
    opened.push(first, second);

    await first.inboxItems.add({
      id: crypto.randomUUID(),
      title: "Private capture",
      seen: false,
      version: 1,
      createdAt: new Date().toISOString(),
      syncState: "synced",
    });

    expect(await first.inboxItems.count()).toBe(1);
    expect(await second.inboxItems.count()).toBe(0);
    expect(first.name).not.toBe(second.name);
  });
});
