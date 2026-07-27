// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createThought, deleteThoughtLocally } from "@/offline/commands";
import { RailsDatabase } from "@/offline/db";

import { ThoughtList } from "./thought-list";

vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return { ...actual, useOffline: () => ({ db, sync: vi.fn() }) };
});

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
});

describe("ThoughtList", () => {
  it("browses active Thoughts without presenting them as tasks", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createThought(db, { title: "Conference notes", body: "Ideas" });

    render(<ThoughtList />);

    expect(
      await screen.findByRole("link", { name: /conference notes/i }),
    ).toHaveAttribute("href", expect.stringMatching(/^\/thoughts\//));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not browse deletion tombstones", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    const thought = await createThought(db, {
      title: "Deleted reference",
      body: "",
    });
    await deleteThoughtLocally(db, thought.id);

    render(<ThoughtList />);

    expect(await screen.findByText(/no thoughts yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Deleted reference")).not.toBeInTheDocument();
  });

  it("searches Thought titles and notes locally", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    await createThought(db, { title: "Conference notes", body: "Offline" });
    await createThought(db, { title: "Book quote", body: "A calm idea" });
    const user = userEvent.setup();
    render(<ThoughtList />);

    await user.type(await screen.findByRole("searchbox"), "calm");

    expect(await screen.findByText("Book quote")).toBeInTheDocument();
    expect(screen.queryByText("Conference notes")).not.toBeInTheDocument();
  });
});
