// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, within } from "@testing-library/react";
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
});
