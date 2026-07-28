// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase, type LocalFocusSession } from "@/offline/db";
import { createTask } from "@/offline/task-commands";

import { FocusSession, formatElapsed } from "./focus-session";

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

afterEach(async () => {
  await db?.delete();
  sync.mockClear();
});

function baseSession(
  overrides: Partial<LocalFocusSession> = {},
): LocalFocusSession {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    taskId: "33333333-3333-4333-8333-333333333333",
    status: "running",
    accumulatedSeconds: 0,
    lastResumedAt: "2026-07-27T14:00:00.000Z",
    distractionCount: 0,
    startedAt: "2026-07-27T14:00:00.000Z",
    completedAt: null,
    version: 1,
    createdAt: "2026-07-27T14:00:00.000Z",
    syncState: "synced",
    ...overrides,
  };
}

describe("formatElapsed", () => {
  it("counts up as m:ss and grows to h:mm:ss past an hour", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(5)).toBe("0:05");
    expect(formatElapsed(754)).toBe("12:34");
    expect(formatElapsed(3723)).toBe("1:02:03");
    // Never negative under a backward clock.
    expect(formatElapsed(-10)).toBe("0:00");
  });
});

describe("FocusSession", () => {
  it("shows the running count-up from the last resume", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(
      db,
      { title: "Write the report" },
      { id: "33333333-3333-4333-8333-333333333333" },
    );

    render(
      <FocusSession
        now="2026-07-27T14:01:30.000Z"
        onComplete={() => {}}
        session={baseSession({ accumulatedSeconds: 30 })}
      />,
    );

    const card = await screen.findByLabelText("Focus session");
    expect(
      await within(card).findByText("Write the report"),
    ).toBeInTheDocument();
    // 30 accumulated + 90 seconds since the resume = 2:00.
    expect(within(card).getByRole("timer")).toHaveTextContent("2:00");
    expect(
      within(card).getByText("Counting up — no rush."),
    ).toBeInTheDocument();
  });

  it("freezes the timer and offers Resume while paused", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(
      db,
      { title: "Deep work" },
      { id: "33333333-3333-4333-8333-333333333333" },
    );

    render(
      <FocusSession
        now="2026-07-27T15:00:00.000Z"
        onComplete={() => {}}
        session={baseSession({
          status: "paused",
          accumulatedSeconds: 125,
          lastResumedAt: null,
        })}
      />,
    );

    const card = await screen.findByLabelText("Focus session");
    // Frozen at the accumulated total regardless of how much later "now" is.
    expect(within(card).getByRole("timer")).toHaveTextContent("2:05");
    expect(within(card).getByText("Paused.")).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Resume" }),
    ).toBeInTheDocument();
  });

  it("saves a distraction to the Inbox and confirms without leaving the task", async () => {
    const user = userEvent.setup();
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(
      db,
      { title: "Write the report" },
      { id: "33333333-3333-4333-8333-333333333333" },
    );
    const session = baseSession();
    await db.focusSessions.add(session);

    render(
      <FocusSession
        now="2026-07-27T14:01:00.000Z"
        onComplete={() => {}}
        session={session}
      />,
    );

    const input = await screen.findByLabelText(/park it and stay here/i);
    await user.type(input, "Reply to Sam");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // The distraction lands in the Inbox as an unseen item.
    await vi.waitFor(async () => {
      const items = await db.inboxItems.toArray();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ title: "Reply to Sam", seen: false });
    });
    // Subtle confirmation, the input is cleared, and focus stays on capture.
    expect(await screen.findByText("Saved to Inbox.")).toBeInTheDocument();
    expect(input).toHaveValue("");
    // The session's captured-distraction count advanced.
    await vi.waitFor(async () => {
      expect((await db.focusSessions.get(session.id))?.distractionCount).toBe(
        1,
      );
    });
  });

  it("shows a calm reassessment once the estimate is reached, never overdue language", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(
      db,
      { title: "Deep work", estimateMinutes: 25 },
      { id: "33333333-3333-4333-8333-333333333333" },
    );

    render(
      <FocusSession
        // 30 minutes elapsed against a 25-minute estimate.
        now="2026-07-27T14:30:00.000Z"
        onComplete={() => {}}
        session={baseSession({ accumulatedSeconds: 0 })}
      />,
    );

    const card = await screen.findByLabelText("Focus session");
    expect(
      await within(card).findByText(/that's just a guess, not a deadline/i),
    ).toBeInTheDocument();
    // No punitive language.
    expect(within(card).queryByText(/overdue|late|failed/i)).toBeNull();
  });

  it("opens a full-screen focus view and returns from it", async () => {
    const user = userEvent.setup();
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(
      db,
      { title: "Write the report" },
      { id: "33333333-3333-4333-8333-333333333333" },
    );

    render(
      <FocusSession
        now="2026-07-27T14:01:30.000Z"
        onComplete={() => {}}
        session={baseSession({ accumulatedSeconds: 30 })}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Enter focus view" }),
    );
    // The overlay is a dialog named by the Task; the background goes inert.
    const view = await screen.findByRole("dialog", {
      name: "Write the report",
    });
    expect(within(view).getByRole("timer")).toHaveTextContent("2:00");

    await user.click(
      within(view).getByRole("button", { name: "Exit focus view" }),
    );
    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("closes the focus view with the keyboard and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createTask(
      db,
      { title: "Write the report" },
      { id: "33333333-3333-4333-8333-333333333333" },
    );

    render(
      <FocusSession
        now="2026-07-27T14:01:30.000Z"
        onComplete={() => {}}
        session={baseSession({ accumulatedSeconds: 30 })}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "Enter focus view",
    });
    await user.click(trigger);
    await screen.findByRole("dialog");

    // Escape closes the overlay and returns focus to where it came from.
    await user.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(trigger).toHaveFocus();
  });
});
