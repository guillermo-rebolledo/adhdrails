// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "@/offline/db";

import { SearchView } from "./search-view";

const push = vi.fn();
let db: RailsDatabase;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/offline/provider", () => ({
  useOffline: () => ({ db, accountId: "owner", sync: vi.fn() }),
  useOptionalOffline: () => ({ db, accountId: "owner", sync: vi.fn() }),
}));

function renderSearchView(debounceMs: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SearchView debounceMs={debounceMs} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  db = new RailsDatabase(`search-view-${crypto.randomUUID()}`);
  push.mockClear();
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await db.delete();
});

describe("SearchView", () => {
  it("debounces online search, labels result types, and announces the count", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              type: "task",
              title: "Quarterly report",
              excerpt: "Draft the summary",
              href: "/tasks/10000000-0000-4000-8000-000000000001/edit",
            },
          ],
          nextCursor: null,
        }),
        { status: 200 },
      ),
    );
    const user = userEvent.setup();
    renderSearchView(10);

    await user.type(
      screen.getByRole("combobox", { name: "Search your Rails content" }),
      "report",
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("option", { name: /Quarterly report/ }),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "report" }),
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 result found");
    expect(screen.getByText("Task")).toBeInTheDocument();
  });

  it("uses the Dexie replica offline and opens a result with the keyboard", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await db.thoughts.add({
      id: "20000000-0000-4000-8000-000000000001",
      title: "Conference notes",
      body: "Questions for the speaker",
      sourceInboxItemId: null,
      version: 1,
      deletedAt: null,
      createdAt: "2026-07-28T08:00:00.000Z",
      updatedAt: "2026-07-28T08:00:00.000Z",
      syncState: "synced",
    });
    const user = userEvent.setup();
    renderSearchView(10);

    const input = screen.getByRole("combobox", {
      name: "Search your Rails content",
    });
    await user.type(input, "conferance");
    await screen.findByRole("option", { name: /Conference notes/ });
    await user.keyboard("{ArrowDown}{Enter}");

    expect(fetch).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(
      "/thoughts/20000000-0000-4000-8000-000000000001",
    );
    expect(screen.getByText("Offline results")).toBeInTheDocument();
  });

  it("loads the next cursor page without replacing prior results", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "10000000-0000-4000-8000-000000000001",
                type: "task",
                title: "Project one",
                excerpt: "",
                href: "/tasks/10000000-0000-4000-8000-000000000001/edit",
              },
            ],
            nextCursor: "page-2",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "10000000-0000-4000-8000-000000000002",
                type: "task",
                title: "Project two",
                excerpt: "",
                href: "/tasks/10000000-0000-4000-8000-000000000002/edit",
              },
            ],
            nextCursor: null,
          }),
        ),
      );
    const user = userEvent.setup();
    renderSearchView(10);

    await user.type(
      screen.getByRole("combobox", { name: "Search your Rails content" }),
      "project",
    );
    await screen.findByRole("option", { name: /Project one/ });
    await user.click(screen.getByRole("button", { name: "Load more results" }));

    await waitFor(() =>
      expect(
        screen.getAllByRole("option").map((option) => option.textContent),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Project one"),
          expect.stringContaining("Project two"),
        ]),
      ),
    );
  });
});
