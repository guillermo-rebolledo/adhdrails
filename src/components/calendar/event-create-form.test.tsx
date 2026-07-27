// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "@/offline/db";

import { EventCreateForm } from "./event-create-form";

const sync = vi.fn().mockResolvedValue(undefined);
const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return { ...actual, useOffline: () => ({ db, sync }) };
});

let db: RailsDatabase;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(async () => {
  await db?.delete();
  sync.mockClear();
  push.mockClear();
});

describe("EventCreateForm", () => {
  it("creates a 30-minute local event from wall-clock input and returns to the calendar", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<EventCreateForm timeZone="America/New_York" />);

    await user.type(
      screen.getByRole("textbox", { name: "Event title" }),
      "Dentist",
    );
    // Overwrite the client-seeded date/time defaults with explicit values.
    const date = screen.getByLabelText("Date");
    await user.clear(date);
    await user.type(date, "2026-07-20");
    const time = screen.getByLabelText("Start time");
    await user.clear(time);
    await user.type(time, "09:00");

    await user.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(async () => expect(await db.events.count()).toBe(1));
    const [event] = await db.events.toArray();
    expect(event).toMatchObject({
      title: "Dentist",
      // 09:00 in New York (EDT) is 13:00Z; default duration is 30 minutes.
      startAt: "2026-07-20T13:00:00Z",
      endAt: "2026-07-20T13:30:00Z",
      startTimeZone: "America/New_York",
      status: "confirmed",
      origin: "local",
      syncState: "pending",
    });
    expect(sync).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/calendar");
  });

  it("honors a chosen duration", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<EventCreateForm timeZone="America/New_York" />);

    await user.type(
      screen.getByRole("textbox", { name: "Event title" }),
      "Long meeting",
    );
    const date = screen.getByLabelText("Date");
    await user.clear(date);
    await user.type(date, "2026-07-20");
    const time = screen.getByLabelText("Start time");
    await user.clear(time);
    await user.type(time, "09:00");
    await user.selectOptions(screen.getByLabelText("Duration"), "90");

    await user.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(async () => expect(await db.events.count()).toBe(1));
    const [event] = await db.events.toArray();
    expect(event.endAt).toBe("2026-07-20T14:30:00Z");
  });

  it("does not submit without a title", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<EventCreateForm timeZone="America/New_York" />);

    expect(screen.getByRole("button", { name: "Create event" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Create event" }));
    expect(await db.events.count()).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });
});
