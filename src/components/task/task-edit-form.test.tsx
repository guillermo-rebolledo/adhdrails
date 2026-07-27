// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "@/offline/db";
import { createTask } from "@/offline/task-commands";

import { TaskEditForm } from "./task-edit-form";

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

afterEach(async () => {
  await db?.delete();
  sync.mockClear();
  push.mockClear();
});

describe("TaskEditForm", () => {
  it("loads the task title and saves an edit through the offline boundary", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const task = await createTask(db, { title: "Draft title" });
    await db.tasks.update(task.id, { version: 3, syncState: "synced" });
    await db.outbox.clear();
    const user = userEvent.setup();
    render(<TaskEditForm taskId={task.id} />);

    const input = await screen.findByRole("textbox", { name: "Task title" });
    expect(input).toHaveValue("Draft title");

    await user.clear(input);
    await user.type(input, "Final title");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(async () =>
      expect((await db.tasks.get(task.id))?.title).toBe("Final title"),
    );
    const update = await db.outbox
      .filter((entry) => entry.operation === "update")
      .first();
    expect(update?.baseVersion).toBe(3);
    expect(push).toHaveBeenCalledWith("/today");
  });

  it("shows an unavailable notice for a missing task", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    render(<TaskEditForm taskId="11111111-1111-4111-8111-111111111111" />);

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });
});
