// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "@/offline/db";

import { ThoughtForm } from "./thought-form";

const push = vi.fn();
const sync = vi.fn().mockResolvedValue(undefined);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return {
    ...actual,
    useOffline: () => ({ accountId: "test", db, sync }),
  };
});

let db: RailsDatabase;

afterEach(async () => {
  await db?.delete();
  localStorage.clear();
  push.mockClear();
  sync.mockClear();
});

describe("ThoughtForm", () => {
  it("restores a device-local draft and clears it after creation", async () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    localStorage.setItem(
      "rails:thought-draft:test:new",
      JSON.stringify({ title: "Draft title", body: "Draft detail" }),
    );
    const user = userEvent.setup();

    render(<ThoughtForm />);

    expect(screen.getByLabelText("Title")).toHaveValue("Draft title");
    expect(screen.getByLabelText("Notes")).toHaveValue("Draft detail");
    await user.click(screen.getByRole("button", { name: "Save Thought" }));

    await waitFor(() => expect(db.thoughts.count()).resolves.toBe(1));
    expect(localStorage.getItem("rails:thought-draft:test:new")).toBeNull();
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/thoughts\//));
  });

  it("identifies the content as a non-actionable reference", () => {
    db = new RailsDatabase(`test-${crypto.randomUUID()}`);
    render(<ThoughtForm />);

    expect(screen.getByText(/reference, not a task/i)).toBeInTheDocument();
  });
});
