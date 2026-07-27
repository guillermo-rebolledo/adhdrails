// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "@/offline/db";
import { createTask } from "@/offline/task-commands";

import { TaskList } from "./task-list";

const sync = vi.fn().mockResolvedValue(undefined);

vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return { ...actual, useOffline: () => ({ db, sync }) };
});

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
  sync.mockClear();
});

describe("TaskList", () => {
  it("shows a calm empty state when there are no tasks", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    render(<TaskList />);

    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
  });

  it("completes a task with a calm acknowledgement and an undo path", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const task = await createTask(db, { title: "Write the report" });
    const user = userEvent.setup();
    render(<TaskList />);

    await user.click(await screen.findByRole("button", { name: "Complete" }));

    // Calm, non-punitive acknowledgement announced accessibly.
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/nicely done/i);
    expect(status).not.toHaveTextContent(/streak|score|overdue/i);

    // The completed task leaves the available list.
    await waitFor(() =>
      expect(screen.queryByText("Write the report")).not.toBeInTheDocument(),
    );
    expect((await db.tasks.get(task.id))?.status).toBe("completed");

    // Undo returns it to active.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(screen.getByText("Write the report")).toBeInTheDocument(),
    );
    expect((await db.tasks.get(task.id))?.status).toBe("active");
  });

  it("hides a deleted task and restores it on undo", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const task = await createTask(db, { title: "Delete me" });
    const user = userEvent.setup();
    render(<TaskList />);

    await user.click(
      await screen.findByRole("button", { name: "Delete Delete me" }),
    );

    expect(await screen.findByText("Task deleted.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Delete me")).not.toBeInTheDocument(),
    );
    // Nothing is finalized during the Undo window.
    expect(
      await db.outbox.filter((e) => e.operation === "delete").count(),
    ).toBe(0);

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(screen.getByText("Delete me")).toBeInTheDocument(),
    );
    expect((await db.tasks.get(task.id))?.deletedAt).toBeNull();
  });

  it("finalizes a deletion after the undo window with a tombstone delete", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const task = await createTask(db, { title: "Gone soon" });
    const user = userEvent.setup();
    render(<TaskList undoWindowMs={20} />);

    await user.click(
      await screen.findByRole("button", { name: "Delete Gone soon" }),
    );

    // Once the (test-shortened) window elapses the deletion finalizes: the row
    // is gone and a single tombstone-writing delete is queued.
    await waitFor(async () =>
      expect(await db.tasks.get(task.id)).toBeUndefined(),
    );
    const deletes = await db.outbox
      .filter((e) => e.operation === "delete")
      .toArray();
    expect(deletes).toHaveLength(1);
    expect(deletes[0].entityId).toBe(task.id);
  });
});
