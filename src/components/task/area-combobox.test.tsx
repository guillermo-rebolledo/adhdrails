// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RailsDatabase } from "@/offline/db";

import { AreaCombobox } from "./area-combobox";

const sync = vi.fn().mockResolvedValue(undefined);

vi.mock("@/offline/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/offline/provider")>(
      "@/offline/provider",
    );
  return { ...actual, useOffline: () => ({ db, sync }) };
});

let db: RailsDatabase;

/** A tiny harness that owns the selected area id, as the Task form does. */
function Harness() {
  const [areaId, setAreaId] = useState<string | null>(null);
  return (
    <div>
      <AreaCombobox onValueChange={setAreaId} value={areaId} />
      <output aria-label="selected">{areaId ?? "none"}</output>
    </div>
  );
}

beforeEach(() => {
  db = new RailsDatabase(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db?.delete();
  sync.mockClear();
});

describe("AreaCombobox", () => {
  it("creates a new Area on entry and selects it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "Work");

    await user.click(screen.getByText(/Create/));

    // The Area is persisted locally and queued for sync, and becomes the selection.
    await waitFor(async () => expect(await db.areas.count()).toBe(1));
    const [area] = await db.areas.toArray();
    expect(area.name).toBe("Work");
    expect(screen.getByLabelText("selected")).toHaveTextContent(area.id);
    expect(sync).toHaveBeenCalled();
  });

  it("reuses an existing Area instead of creating a duplicate", async () => {
    await db.areas.add({
      id: crypto.randomUUID(),
      name: "Home",
      version: 1,
      createdAt: new Date().toISOString(),
      syncState: "synced",
    });
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "Home");

    // Selecting the existing option does not offer a "Create" row for an exact match.
    await user.click(screen.getByRole("option", { name: "Home" }));

    await waitFor(() =>
      expect(screen.getByLabelText("selected")).not.toHaveTextContent("none"),
    );
    expect(await db.areas.count()).toBe(1);
  });
});
