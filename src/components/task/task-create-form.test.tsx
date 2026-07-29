// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "@/offline/db";

import { TaskCreateForm } from "./task-create-form";

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

describe("TaskCreateForm", () => {
  it("creates a title-only task and returns to Today", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<TaskCreateForm />);

    await user.type(
      screen.getByRole("textbox", { name: "Task title" }),
      "Write the report",
    );
    await user.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(async () => expect(await db.tasks.count()).toBe(1));
    const [stored] = await db.tasks.toArray();
    expect(stored).toMatchObject({
      title: "Write the report",
      status: "active",
    });
    expect(sync).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/today");
  });

  it("prefills the title from an inbox capture", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    render(<TaskCreateForm initialTitle="Follow up with Sam" />);

    expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue(
      "Follow up with Sam",
    );
  });

  it("does not create an empty task", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    render(<TaskCreateForm />);

    expect(screen.getByRole("button", { name: "Create task" })).toBeDisabled();
    expect(await db.tasks.count()).toBe(0);
  });

  it("captures optional planning metadata alongside the title", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<TaskCreateForm />);

    await user.type(
      screen.getByRole("textbox", { name: "Task title" }),
      "Write the report",
    );
    fireEvent.change(screen.getByLabelText("Scheduled for"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText("Time (optional)"), {
      target: { value: "09:30" },
    });
    fireEvent.change(screen.getByLabelText("Estimate (minutes)"), {
      target: { value: "25" },
    });
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("checkbox", { name: "Important" }));
    await user.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(async () => expect(await db.tasks.count()).toBe(1));
    const [stored] = await db.tasks.toArray();
    expect(stored).toMatchObject({
      title: "Write the report",
      scheduledDate: "2026-08-01",
      scheduledTime: "09:30",
      estimateMinutes: 25,
      energy: "high",
      important: true,
    });
  });

  it("keeps a date-only task distinct from a timed one", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const user = userEvent.setup();
    render(<TaskCreateForm />);

    await user.type(
      screen.getByRole("textbox", { name: "Task title" }),
      "Water the plants",
    );
    // The time field is disabled until a date is present.
    expect(screen.getByLabelText("Time (optional)")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Scheduled for"), {
      target: { value: "2026-08-02" },
    });
    await user.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(async () => expect(await db.tasks.count()).toBe(1));
    const [stored] = await db.tasks.toArray();
    expect(stored).toMatchObject({
      scheduledDate: "2026-08-02",
      scheduledTime: null,
    });
  });
});
