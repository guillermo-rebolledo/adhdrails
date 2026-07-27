// @vitest-environment jsdom

import "fake-indexeddb/auto";

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

let db: RailsDatabase;

// A Wednesday reference; the agenda week is Mon 2026-07-20 .. Sun 2026-07-26.
const REFERENCE = "2026-07-22T12:00:00Z";
const NY = "America/New_York";

afterEach(async () => {
  await db?.delete();
  sync.mockClear();
});

function renderAgenda() {
  return render(
    <WeeklyAgenda locale="en-US" reference={REFERENCE} timeZone={NY} />,
  );
}

describe("WeeklyAgenda", () => {
  it("renders the same event in both the desktop grid and the mobile list", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    // 17:00Z is 13:00 (1:00 PM) local in New York on Wednesday the 22nd.
    await createEvent(db, {
      title: "Team sync",
      startAt: "2026-07-22T17:00:00Z",
      timeZone: NY,
    });

    renderAgenda();

    const grid = await screen.findByTestId("agenda-week-grid");
    const list = await screen.findByTestId("agenda-week-list");
    // Full desktop/mobile feature parity: the event appears in both layouts.
    expect(within(grid).getByText("Team sync")).toBeInTheDocument();
    expect(within(list).getByText("Team sync")).toBeInTheDocument();
    // Its local time range is shown, and a freshly created event carries a
    // Pending sync cue until the outbox drains.
    expect(within(grid).getAllByText(/1:00/).length).toBeGreaterThan(0);
    expect(within(grid).getAllByText("Pending").length).toBeGreaterThan(0);
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

    const grid = await screen.findByTestId("agenda-week-grid");
    expect(within(grid).getAllByText("Local").length).toBeGreaterThan(0);
  });

  it("shows seven day columns with calm empty-day copy", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    renderAgenda();

    const grid = await screen.findByTestId("agenda-week-grid");
    // Monday through Sunday headings, e.g. "Mon, Jul 20".
    expect(within(grid).getByText("Mon, Jul 20")).toBeInTheDocument();
    expect(within(grid).getByText("Sun, Jul 26")).toBeInTheDocument();
    expect(within(grid).getAllByText("No events")).toHaveLength(7);
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

    // The grid renders (empty), but the deleted event never appears.
    await screen.findByTestId("agenda-week-grid");
    expect(screen.queryByText("Cancelled soon")).not.toBeInTheDocument();
  });
});
