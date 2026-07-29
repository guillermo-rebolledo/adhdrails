// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "./db";
import { refreshServerViews } from "./refresh-server-views";

let db: RailsDatabase;

afterEach(async () => {
  vi.unstubAllGlobals();
  await db?.delete();
});

describe("refreshServerViews", () => {
  it("invalidates Task collection membership after synchronization", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ thoughts: [] }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ items: [] }), { status: 200 }),
        ),
    );

    await refreshServerViews(db, queryClient);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tasks"] });
  });
});
