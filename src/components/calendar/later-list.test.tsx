// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventResponse } from "@/domain/event/event";

import { LaterList } from "./later-list";

const apiRequest = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

afterEach(() => {
  apiRequest.mockReset();
});

const NY = "America/New_York";
const FROM = "2026-07-27T04:00:00Z";

function serverEvent(overrides: Partial<EventResponse>): EventResponse {
  return {
    id: crypto.randomUUID(),
    title: "Event",
    startAt: "2026-08-03T16:00:00Z",
    endAt: "2026-08-03T16:30:00Z",
    startTimeZone: NY,
    endTimeZone: NY,
    isAllDay: false,
    allDayStartDate: null,
    allDayEndDate: null,
    recurringEventId: null,
    recurrence: null,
    status: "confirmed",
    origin: "local",
    version: 1,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function renderLater() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LaterList from={FROM} locale="en-US" timeZone={NY} />
    </QueryClientProvider>,
  );
}

describe("LaterList", () => {
  it("groups events by month and loads the next cursor page on demand", async () => {
    apiRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          items: [
            serverEvent({
              title: "August one",
              startAt: "2026-08-03T16:00:00Z",
            }),
            serverEvent({
              title: "August two",
              startAt: "2026-08-20T16:00:00Z",
            }),
          ],
          nextCursor: "cursor-2",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          items: [
            serverEvent({
              title: "September one",
              startAt: "2026-09-05T16:00:00Z",
            }),
          ],
          nextCursor: null,
        },
      });

    const user = userEvent.setup();
    renderLater();

    // First page: an August month section with both August events.
    const august = await screen.findByRole("region", { name: "August 2026" });
    expect(august).toBeInTheDocument();
    expect(screen.getByText("August one")).toBeInTheDocument();
    expect(screen.getByText("August two")).toBeInTheDocument();

    // Load more fetches the next cursor page and appends September.
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(screen.getByText("September one")).toBeInTheDocument(),
    );

    // The second request carried the cursor from the first page.
    expect(apiRequest.mock.calls[1][0]).toContain("cursor=cursor-2");
    // Exhausted: no further Load more.
    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a calm empty state when nothing is scheduled later", async () => {
    apiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      body: { items: [], nextCursor: null },
    });

    renderLater();

    expect(
      await screen.findByText(/nothing scheduled beyond this week/i),
    ).toBeInTheDocument();
  });

  it("passes the Later window start as the from parameter", async () => {
    apiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      body: { items: [], nextCursor: null },
    });

    renderLater();

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    expect(apiRequest.mock.calls[0][0]).toContain(
      `from=${encodeURIComponent(FROM)}`,
    );
  });
});
