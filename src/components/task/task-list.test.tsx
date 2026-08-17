// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "@/offline/db";
import { createTask } from "@/offline/task-commands";

import { TaskItems, TaskList } from "./task-list";

const sync = vi.fn().mockResolvedValue(undefined);

vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return { ...actual, useOffline: () => ({ db, sync }) };
});

let db: RailsDatabase;

async function createSyncedTask(title: string) {
  const task = await createTask(db, { title });
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.update(task.id, { syncState: "synced" });
    await db.outbox.clear();
  });
  return task;
}

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
    const task = await createSyncedTask("Write the report");
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
    // Completion stays local while Undo is available, so a fast Undo cannot
    // race an in-flight completion response and be overwritten by it.
    expect(sync).not.toHaveBeenCalled();

    // Undo returns it to active.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(screen.getByText("Write the report")).toBeInTheDocument(),
    );
    expect((await db.tasks.get(task.id))?.status).toBe("active");
    expect(sync).toHaveBeenCalledOnce();
  });

  it("synchronizes a completion when its Undo window expires", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createSyncedTask("Commit the report");
    const user = userEvent.setup();
    render(<TaskList completionNoticeMs={20} />);

    await user.click(await screen.findByRole("button", { name: "Complete" }));

    expect(sync).not.toHaveBeenCalled();
    await waitFor(() => expect(sync).toHaveBeenCalledOnce());
    expect(
      screen.queryByText(/task complete\. nicely done/i),
    ).not.toBeInTheDocument();
  });

  it("synchronizes a held completion when the list unmounts", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createSyncedTask("Leave the page");
    const user = userEvent.setup();
    const { unmount } = render(<TaskList />);

    await user.click(await screen.findByRole("button", { name: "Complete" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/nicely done/i);
    expect(sync).not.toHaveBeenCalled();

    unmount();

    expect(sync).toHaveBeenCalledOnce();
  });

  it("waits for an older pending mutation before holding completion", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const task = await createTask(db, { title: "Newly created task" });
    const user = userEvent.setup();
    let releaseSync!: () => void;
    sync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSync = resolve;
        }),
    );
    render(<TaskList />);

    const completion = user.click(
      await screen.findByRole("button", { name: "Complete" }),
    );
    await waitFor(() => expect(sync).toHaveBeenCalledOnce());

    // The older request must settle before completion changes local state.
    expect((await db.tasks.get(task.id))?.status).toBe("active");
    releaseSync();
    await completion;

    await waitFor(async () =>
      expect((await db.tasks.get(task.id))?.status).toBe("completed"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/nicely done/i);
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

  // The Tasks collections view orders by the server's page sequence and keeps
  // local-only, unsynced Tasks after the server-backed ones. That order is the
  // caller's to decide, so the list must render it verbatim rather than derive
  // one of its own — a `createdAt` sort here would look right on Today (which
  // happens to order that way) while silently interleaving an optimistic Task
  // among server rows everywhere else.
  it("renders the caller's task order verbatim", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const oldest = await createSyncedTask("Oldest by creation");
    const newest = await createSyncedTask("Newest by creation");

    // Deliberately the reverse of creation order, as a paginated server page
    // carrying a trailing unsynced Task would be.
    render(<TaskItems tasks={[newest, oldest]} />);

    const rendered = (await screen.findAllByRole("listitem")).map((row) =>
      row.textContent?.replace(/Complete|Restore|Edit|Delete/g, "").trim(),
    );
    expect(rendered).toEqual(["Newest by creation", "Oldest by creation"]);
  });

  // A row is held on screen for one collapse after it leaves the list. It has
  // to be held in the slot it occupied: re-appending it would make the row jump
  // to the end of the list to animate out, which is worse than not animating.
  it("collapses a removed row in the slot it held", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const first = await createSyncedTask("First");
    const second = await createSyncedTask("Second");
    const third = await createSyncedTask("Third");
    const user = userEvent.setup();

    // A long exit window so the assertions below describe the collapsing row
    // rather than racing the 260ms one.
    render(<TaskItems rowExitMs={10_000} tasks={[first, second, third]} />);
    await user.click(
      await screen.findByRole("button", { name: "Delete Second" }),
    );
    await screen.findByText("Task deleted.");

    // Mid-collapse the middle row is still present, still in the middle, and
    // inert so its controls cannot be reached on the way out.
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("Second");
    expect(rows[1]).toHaveAttribute("inert");
    expect(rows[0]).not.toHaveAttribute("inert");

    // Undo before the test ends. The deletion is otherwise still pending, and
    // the unmount cleanup would finalize it against a database `afterEach` has
    // already closed — an unhandled rejection attributed to whichever test runs
    // next rather than to this one.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(screen.queryByText("Task deleted.")).not.toBeInTheDocument(),
    );
  });
});
