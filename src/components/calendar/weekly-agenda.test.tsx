// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "@/offline/db";
import { createEvent, deleteEventLocally } from "@/offline/event-commands";

import { WeeklyAgenda } from "./weekly-agenda";

const sync = vi.fn().mockResolvedValue(undefined);

vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return { ...actual, useOffline: () => ({ db, sync }) };
});

// The agenda hydrates from the server mirror on mount; stub that boundary so the
// component tests stay focused on Dexie-driven rendering, not the network.
const syncCalendarMirror = vi.fn().mockResolvedValue(null);
const fetchEventWindow = vi.fn().mockResolvedValue([]);

vi.mock("@/offline/event-pull", () => ({
  syncCalendarMirror: () => syncCalendarMirror(),
  fetchEventWindow: (...args: unknown[]) => fetchEventWindow(...args),
}));

let db: RailsDatabase;

// A Wednesday reference; the agenda week is Mon 2026-07-20 .. Sun 2026-07-26.
const REFERENCE = "2026-07-22T12:00:00Z";
const NY = "America/New_York";

afterEach(async () => {
  await db?.delete();
  sync.mockClear();
  syncCalendarMirror.mockClear();
  fetchEventWindow.mockClear();
});

function renderAgenda() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WeeklyAgenda locale="en-US" reference={REFERENCE} timeZone={NY} />
    </QueryClientProvider>,
  );
}

describe("WeeklyAgenda", () => {
  it("renders an event once, in a single layout shared by every viewport", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    // 17:00Z is 13:00 (1:00 PM) local in New York on Wednesday the 22nd.
    await createEvent(db, {
      title: "Team sync",
      startAt: "2026-07-22T17:00:00Z",
      timeZone: NY,
    });

    renderAgenda();

    const week = await screen.findByTestId("agenda-week");
    // One vertical layout serves desktop and mobile alike, so the event is in
    // the DOM exactly once — no duplicated copy for a screen reader to repeat.
    expect(screen.getAllByText("Team sync")).toHaveLength(1);
    expect(within(week).getByText("Team sync")).toBeInTheDocument();
    // Its local time range is shown, and a freshly created event carries a
    // Pending sync cue until the outbox drains.
    expect(within(week).getAllByText(/1:00/).length).toBeGreaterThan(0);
    expect(within(week).getAllByText("Pending").length).toBeGreaterThan(0);
  });

  it("places each event under its own day", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createEvent(db, {
      title: "Monday kickoff",
      startAt: "2026-07-20T14:00:00Z",
      timeZone: NY,
    });
    await createEvent(db, {
      title: "Friday wrap-up",
      startAt: "2026-07-24T14:00:00Z",
      timeZone: NY,
    });

    renderAgenda();

    await screen.findByTestId("agenda-week");
    const monday = screen.getByRole("heading", { name: "Mon, Jul 20" });
    const friday = screen.getByRole("heading", { name: "Fri, Jul 24" });
    expect(
      within(monday.parentElement!).getByText("Monday kickoff"),
    ).toBeInTheDocument();
    expect(
      within(friday.parentElement!).getByText("Friday wrap-up"),
    ).toBeInTheDocument();
  });

  it("shows a Local cue once an event is synced", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const event = await createEvent(db, {
      title: "Team sync",
      startAt: "2026-07-22T17:00:00Z",
      timeZone: NY,
    });
    await db.events.update(event.id, { syncState: "synced" });

    renderAgenda();

    const week = await screen.findByTestId("agenda-week");
    expect(within(week).getAllByText("Local").length).toBeGreaterThan(0);
  });

  it("shows all seven days with calm empty-day copy", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    renderAgenda();

    const week = await screen.findByTestId("agenda-week");
    // Monday through Sunday headings, e.g. "Mon, Jul 20".
    expect(within(week).getByText("Mon, Jul 20")).toBeInTheDocument();
    expect(within(week).getByText("Sun, Jul 26")).toBeInTheDocument();
    expect(within(week).getAllByText("No events")).toHaveLength(7);
  });

  it("imports the Google mirror and shows a last-synced cue for a mirrored event", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    // A previously imported Google event living in the replica.
    await db.events.put({
      id: crypto.randomUUID(),
      title: "Imported meeting",
      startAt: "2026-07-22T18:00:00Z",
      endAt: "2026-07-22T18:30:00Z",
      startTimeZone: NY,
      endTimeZone: NY,
      isAllDay: false,
      recurringEventId: null,
      status: "confirmed",
      origin: "google",
      version: 1,
      createdAt: "2026-07-20T10:00:00Z",
      deletedAt: null,
      syncState: "synced",
    });
    syncCalendarMirror.mockResolvedValueOnce({
      imported: 1,
      removed: 0,
      lastSyncedAt: "2026-07-22T17:00:00Z",
    });

    renderAgenda();

    const week = await screen.findByTestId("agenda-week");
    expect(within(week).getByText("Imported meeting")).toBeInTheDocument();
    // The agenda triggers a mirror import and hydrates this week's window.
    expect(syncCalendarMirror).toHaveBeenCalled();
    expect(fetchEventWindow).toHaveBeenCalled();
    expect(await screen.findByText(/Last synced/)).toBeInTheDocument();
    // A mirrored Google event shows the Synced cue, distinct from a local one.
    expect(within(week).getAllByText("Synced").length).toBeGreaterThan(0);
  });

  it("hides an event with a pending optimistic deletion", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const event = await createEvent(db, {
      title: "Cancelled soon",
      startAt: "2026-07-22T17:00:00Z",
      timeZone: NY,
    });
    await deleteEventLocally(db, event.id);

    renderAgenda();

    // The week renders (empty), but the deleted event never appears.
    await screen.findByTestId("agenda-week");
    expect(screen.queryByText("Cancelled soon")).not.toBeInTheDocument();
  });
});
