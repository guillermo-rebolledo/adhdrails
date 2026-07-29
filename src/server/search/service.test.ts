import { describe, expect, it, vi } from "vitest";

import { createSearchService } from "./service";

describe("Search service", () => {
  it("keeps the query and cursor within the authenticated account scope", async () => {
    const page = { items: [], nextCursor: null };
    const search = vi.fn().mockResolvedValue(page);
    const service = createSearchService({ search } as never);

    await expect(
      service.search("user_1", {
        query: "quarterly report",
        cursor: "next-page",
      }),
    ).resolves.toBe(page);
    expect(search).toHaveBeenCalledWith(
      "user_1",
      "quarterly report",
      "next-page",
    );
  });
});
