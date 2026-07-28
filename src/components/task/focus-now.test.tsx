// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor, within } from "@testing-library/react";
import Dexie from "dexie";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "@/offline/db";
import { createTask } from "@/offline/task-commands";

import { FocusNow } from "./focus-now";

const TZ = "America/New_York";
const LOCALE = "en-US";
// 10:00 EDT on Monday 2026-07-27.
const NOW = "2026-07-27T14:00:00Z";

const sync = vi.fn().mockResolvedValue(undefined);

vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return {
    ...actual,
    useOffline: () => ({ db, sync, accountId: "acct-1" }),
  };
});

let db: RailsDatabase;

function renderFocusNow() {
  return render(<FocusNow locale={LOCALE} now={NOW} timeZone={TZ} />);
}

afterEach(async () => {
  await db?.delete();
  sync.mockClear();
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

describe("FocusNow", () => {
  it("shows a calm empty state when nothing is appropriate now", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    renderFocusNow();

    expect(
      await screen.findByText(/nothing to focus on right now/i),
    ).toBeInTheDocument();
    // Calm — no urgency or guilt language.
    expect(screen.queryByText(/overdue|hurry|late/i)).not.toBeInTheDocument();
  });

  it("treats an older local task without planning fields as flexible work", async () => {
    const name = `test-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(5).stores({
      inboxItems: "id, createdAt, syncState, deletedAt",
      tasks: "id, status, createdAt, deletedAt, syncState",
      thoughts: "id, createdAt, updatedAt, deletedAt, syncState",
      events: "id, startAt, deletedAt, syncState",
      outbox: "id, entity, status, sequence, createdAt",
    });
    await legacy.table("tasks").add({
      id: crypto.randomUUID(),
      title: "Legacy local task",
      status: "active",
      version: 1,
      createdAt: "2026-07-20T12:00:00Z",
      deletedAt: null,
      syncState: "synced",
    });
    legacy.close();

    db = new RailsDatabase(name);
    renderFocusNow();

    expect(await screen.findByText("Legacy local task")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("recommends one task with a concise explanation and an explicit Start", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(db, { title: "File the taxes", important: true });
    await createTask(db, { title: "Water the plants" });
    renderFocusNow();

    const card = await screen.findByText("File the taxes");
    expect(card).toBeInTheDocument();
    expect(screen.getByText("Marked important.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();

    // The other task is offered, never hidden.
    const others = screen.getByRole("list", { name: "Choose another task" });
    expect(within(others).getByText("Water the plants")).toBeInTheDocument();
  });

  it("starts a persistent focus session with a count-up timer", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(db, { title: "Write the report" });
    const user = userEvent.setup();
    renderFocusNow();

    await user.click(await screen.findByRole("button", { name: "Start" }));

    const card = await screen.findByLabelText("Focus session");
    expect(
      await within(card).findByText("Write the report"),
    ).toBeInTheDocument();
    expect(within(card).getByRole("timer")).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Pause" }),
    ).toBeInTheDocument();

    // Exactly one active session is persisted.
    await waitFor(async () =>
      expect(
        await db.focusSessions
          .filter((session) => session.status !== "completed")
          .toArray(),
      ).toHaveLength(1),
    );
  });

  it("pauses and resumes without silently losing the session", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(db, { title: "Deep work" });
    const user = userEvent.setup();
    renderFocusNow();

    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.click(await screen.findByRole("button", { name: "Pause" }));

    expect(await screen.findByText("Paused.")).toBeInTheDocument();
    const [paused] = await db.focusSessions.toArray();
    expect(paused.status).toBe("paused");

    await user.click(await screen.findByRole("button", { name: "Resume" }));
    expect(await screen.findByText(/counting up/i)).toBeInTheDocument();
    const [resumed] = await db.focusSessions.toArray();
    expect(resumed.status).toBe("running");
  });

  it("completes with a calm acknowledgement and never auto-starts another task", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(db, { title: "Only task" });
    const user = userEvent.setup();
    renderFocusNow();

    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.click(await screen.findByRole("button", { name: "Complete" }));

    expect(
      await screen.findByText("Focus complete. Nicely done — take a breath."),
    ).toBeInTheDocument();
    // Nothing started on its own — no timer, no new session.
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();

    await waitFor(async () => {
      const [session] = await db.focusSessions.toArray();
      expect(session.status).toBe("completed");
    });

    // Return to Today steps back to the recommendation, still no auto-start.
    await user.click(screen.getByRole("button", { name: "Return to Today" }));
    expect(
      await screen.findByRole("button", { name: "Start" }),
    ).toBeInTheDocument();
  });

  it("lets the user manually choose another task without a carousel", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(db, { title: "Recommended", important: true });
    await createTask(db, { title: "Something else" });
    const user = userEvent.setup();
    renderFocusNow();

    await screen.findByText("Recommended");
    await user.click(
      screen.getByRole("button", { name: "Focus on Something else" }),
    );

    // The chosen task becomes the focus, with an explicit reason.
    expect(screen.getByText("You chose this.")).toBeInTheDocument();
    const others = screen.getByRole("list", { name: "Choose another task" });
    expect(within(others).getByText("Recommended")).toBeInTheDocument();
  });

  it("reorders flexible work to match the selected energy without hiding any", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(db, { title: "High-energy task", energy: "high" });
    await createTask(db, { title: "Low-energy task", energy: "low" });
    const user = userEvent.setup();
    renderFocusNow();

    await screen.findByText("High-energy task");
    await user.click(screen.getByRole("button", { name: "Low" }));

    expect(
      await screen.findByText("Matches your Low energy."),
    ).toBeInTheDocument();
    // The high-energy task is reordered, not removed.
    const others = screen.getByRole("list", { name: "Choose another task" });
    expect(within(others).getByText("High-energy task")).toBeInTheDocument();
  });

  it("defers flexible work to tomorrow, out of the current recommendation", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const task = await createTask(db, { title: "Not urgent" });
    const user = userEvent.setup();
    renderFocusNow();

    await user.click(await screen.findByRole("button", { name: "Not now" }));
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));

    await waitFor(async () =>
      expect((await db.tasks.get(task.id))?.scheduledDate).toBe("2026-07-28"),
    );
    // With its only task deferred, Today rests in the calm empty state.
    expect(
      await screen.findByText(/nothing to focus on right now/i),
    ).toBeInTheDocument();
  });

  it("presents a timed commitment whose time has come, with no defer", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(db, {
      title: "Team standup",
      scheduledDate: "2026-07-27",
      scheduledTime: "09:30",
    });
    renderFocusNow();

    expect(await screen.findByText("Team standup")).toBeInTheDocument();
    expect(screen.getByText(/^Scheduled for/)).toBeInTheDocument();
    // A fixed commitment is not deferrable flexible work.
    expect(
      screen.queryByRole("button", { name: "Not now" }),
    ).not.toBeInTheDocument();
  });
});
