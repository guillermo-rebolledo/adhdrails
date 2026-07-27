// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor, within } from "@testing-library/react";
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

  it("lets the user Start focusing on a task and Stop to step back out", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(db, { title: "Write the report" });
    const user = userEvent.setup();
    renderFocusNow();

    await user.click(await screen.findByRole("button", { name: "Start" }));
    expect(screen.getByText("Focusing on")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    // Back to the recommendation, ready to Start again.
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
