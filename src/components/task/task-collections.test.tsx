// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskResponse } from "@/domain/task/task";
import { RailsDatabase } from "@/offline/db";
import { createTask } from "@/offline/task-commands";

import { TaskCollections } from "./task-collections";

const apiRequest = vi.fn();
const sync = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/api-client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return { ...actual, useOffline: () => ({ db, sync }) };
});

const TODAY = "2026-07-27";
const AREA = "44444444-4444-4444-8444-444444444444";
let db: RailsDatabase;

function serverTask(
  title: string,
  overrides: Partial<TaskResponse> = {},
): TaskResponse {
  return {
    id: crypto.randomUUID(),
    title,
    status: "active",
    scheduledDate: null,
    scheduledTime: null,
    estimateMinutes: null,
    energy: null,
    important: false,
    notes: "",
    areaId: null,
    completedAt: null,
    version: 1,
    createdAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-27T10:00:00.000Z",
    ...overrides,
  };
}

function renderCollections({ retry = false }: { retry?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <TaskCollections today={TODAY} />
    </QueryClientProvider>,
  );
  return { ...result, client };
}

afterEach(async () => {
  apiRequest.mockReset();
  sync.mockClear();
  await db?.delete();
});

describe("TaskCollections", () => {
  it("browses Today, Upcoming, Anytime, and Completed without hiding unscheduled work", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const anytime = [
      serverTask("Unscheduled"),
      serverTask("Scheduled", { scheduledDate: TODAY }),
    ];
    apiRequest.mockImplementation(async (path: string) => {
      const collection = new URL(path, "https://rails.test").searchParams.get(
        "collection",
      );
      const items =
        collection === "today"
          ? [anytime[1]]
          : collection === "upcoming"
            ? [
                serverTask("Next week", {
                  scheduledDate: "2026-08-03",
                }),
              ]
            : collection === "completed"
              ? [serverTask("Finished", { status: "completed" })]
              : anytime;
      return { ok: true, status: 200, body: { items, nextCursor: null } };
    });
    const user = userEvent.setup();
    renderCollections();

    expect(await screen.findByText("Unscheduled")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Today" }));
    expect(await screen.findByText("Scheduled")).toBeInTheDocument();
    expect(screen.queryByText("Unscheduled")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Upcoming" }));
    expect(await screen.findByText("Next week")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Completed" }));
    expect(await screen.findByText("Finished")).toBeInTheDocument();
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });

  it("filters by Area and Energy, then clears both predictably", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await db.areas.put({
      id: AREA,
      name: "Work",
      version: 1,
      createdAt: "2026-07-27T09:00:00.000Z",
      syncState: "synced",
    });
    apiRequest.mockImplementation(async (path: string) => {
      const params = new URL(path, "https://rails.test").searchParams;
      const filtered =
        params.get("areaId") === AREA && params.get("energy") === "low";
      return {
        ok: true,
        status: 200,
        body: {
          items: filtered
            ? [serverTask("Filtered task", { areaId: AREA, energy: "low" })]
            : [serverTask("All tasks")],
          nextCursor: null,
        },
      };
    });
    const user = userEvent.setup();
    renderCollections();
    await screen.findByText("All tasks");

    await user.selectOptions(screen.getByLabelText("Filter by area"), AREA);
    await user.selectOptions(screen.getByLabelText("Filter by energy"), "low");

    expect(await screen.findByText("Filtered task")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Filter by area")).toHaveValue("");
    expect(screen.getByLabelText("Filter by energy")).toHaveValue("");
    await waitFor(() =>
      expect(screen.getByText("All tasks")).toBeInTheDocument(),
    );
  });

  it("loads the next stable cursor page only on request", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    apiRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          items: [serverTask("First page")],
          nextCursor: "cursor-2",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          items: [serverTask("Second page")],
          nextCursor: null,
        },
      });
    const user = userEvent.setup();
    renderCollections();

    await screen.findByText("First page");
    expect(screen.queryByText("Second page")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Second page")).toBeInTheDocument();
    expect(apiRequest.mock.calls[1][0]).toContain("cursor=cursor-2");
  });

  it("retains only a bounded number of loaded pages", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const pages = Array.from({ length: 6 }, (_, index) => ({
      items: Array.from({ length: 20 }, (__, taskIndex) =>
        serverTask(`Page ${index + 1} Task ${taskIndex + 1}`),
      ),
      nextCursor: index === 5 ? null : `cursor-${index + 2}`,
      previousCursor: index === 0 ? null : `previous-${index + 1}`,
    }));
    for (const body of pages) {
      apiRequest.mockResolvedValueOnce({ ok: true, status: 200, body });
    }
    apiRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        ...pages[0],
        nextCursor: "cursor-2",
        previousCursor: null,
      },
    });
    const user = userEvent.setup();
    renderCollections();

    await screen.findByText("Page 1 Task 1");
    for (let page = 2; page <= 6; page += 1) {
      await user.click(screen.getByRole("button", { name: "Load more" }));
      await screen.findByText(`Page ${page} Task 1`);
    }

    expect(screen.queryByText("Page 1 Task 1")).not.toBeInTheDocument();
    expect(screen.getByText("Page 2 Task 1")).toBeInTheDocument();
    expect(screen.getByText("Page 6 Task 20")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(100);

    await user.click(screen.getByRole("button", { name: "Load previous" }));
    expect(await screen.findByText("Page 1 Task 1")).toBeInTheDocument();
    expect(screen.queryByText("Page 6 Task 1")).not.toBeInTheDocument();
    expect(apiRequest.mock.calls[6][0]).toContain("direction=backward");
  });

  it("shows the bounded durable replica while the first server request is pending", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await db.tasks.put({
      ...serverTask("Already saved"),
      deletedAt: null,
      syncState: "synced",
    });
    apiRequest.mockReturnValue(new Promise(() => undefined));

    renderCollections({ retry: true });

    expect(await screen.findByText("Already saved")).toBeInTheDocument();
  });

  it("pages through a deterministic bounded offline window in both directions", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await db.tasks.bulkPut(
      Array.from({ length: 120 }, (_, index) => ({
        ...serverTask(`Offline task ${index + 1}`, {
          createdAt: new Date(2026, 6, 27, 10, 0, index).toISOString(),
        }),
        deletedAt: null,
        syncState: "synced" as const,
      })),
    );
    apiRequest.mockRejectedValue(new TypeError("offline"));
    const user = userEvent.setup();
    renderCollections();

    await screen.findByRole("status");
    expect(await screen.findAllByRole("listitem")).toHaveLength(100);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(20),
    );
    await user.click(screen.getByRole("button", { name: "Load previous" }));
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(100),
    );
  });

  it("falls back to filtered Dexie Tasks when the server view is offline", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(db, { title: "Saved offline", energy: "high" });
    apiRequest.mockRejectedValue(new TypeError("offline"));
    renderCollections();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/showing saved tasks/i);
    expect(await screen.findByText("Saved offline")).toBeInTheDocument();
    expect(
      within(screen.getByRole("tablist", { name: "Task views" })).getAllByRole(
        "tab",
      ),
    ).toHaveLength(4);
  });

  it("moves between Task views with the arrow keys", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    apiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      body: { items: [], nextCursor: null },
    });
    const user = userEvent.setup();
    renderCollections();

    const anytime = screen.getByRole("tab", { name: "Anytime" });
    anytime.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Completed" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Completed" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("clears and disables Energy when browsing fixed commitments", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    apiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      body: { items: [], nextCursor: null },
    });
    const user = userEvent.setup();
    renderCollections();

    const energy = screen.getByLabelText("Filter by energy");
    await user.selectOptions(energy, "low");
    await user.click(screen.getByRole("tab", { name: "Today" }));

    expect(energy).toHaveValue("");
    expect(energy).toBeDisabled();
    await waitFor(() => {
      const todayRequest = apiRequest.mock.calls.find(([path]) =>
        String(path).includes("collection=today"),
      );
      expect(todayRequest?.[0]).not.toContain("energy=");
    });
  });
});
