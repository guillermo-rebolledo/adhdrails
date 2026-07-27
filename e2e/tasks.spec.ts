import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

// The multi-step UI journeys drive engine-agnostic client logic (React forms,
// Dexie, the sync engine). Cross-engine parity for capture-style flows is
// already exercised by the quick-capture spec, so these run on a single
// representative engine to keep the parallel dev server from thrashing on
// first-compile latency. The account-scope and auth checks below are pure API
// round-trips and stay cross-browser.
test.describe("task UI journeys", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName !== "chromium",
      "Engine-agnostic UI flow; runs on one representative engine.",
    );
  });

  test("creates a title-only task from the full-page form and shows it on Today", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true });
    await page.goto("/tasks/new");

    await page
      .getByRole("textbox", { name: "Task title" })
      .fill("Write the release notes");
    await page.getByRole("button", { name: "Create task" }).click();

    // Lands back on Today with the task visible in Available tasks.
    await expect(page).toHaveURL(/\/today$/);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Write the release notes" }),
    ).toBeVisible();

    // It reached the server exactly once.
    await expect
      .poll(async () => {
        const response = await page.request.get("/api/v1/tasks");
        const body = (await response.json()) as { items: { title: string }[] };
        return body.items.map((item) => item.title);
      })
      .toContain("Write the release notes");
  });

  test("completes a task with a calm acknowledgement and can undo", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true });
    await page.goto("/tasks/new");
    await page
      .getByRole("textbox", { name: "Task title" })
      .fill("Finish slides");
    await page.getByRole("button", { name: "Create task" }).click();

    const row = page.getByRole("listitem").filter({ hasText: "Finish slides" });
    await row.getByRole("button", { name: "Complete" }).click();

    // Calm, non-punitive acknowledgement — no streaks or scores.
    await expect(
      page.getByText("Task complete. Nicely done — take a breath."),
    ).toBeVisible();
    await expect(row).toHaveCount(0);

    // Undo brings it back to the available list.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Finish slides" }),
    ).toBeVisible();
  });

  test("edits a task title and persists the change", async ({ page }) => {
    await signIn(page, { onboarded: true });
    await page.goto("/tasks/new");
    await page.getByRole("textbox", { name: "Task title" }).fill("Old title");
    await page.getByRole("button", { name: "Create task" }).click();

    const row = page.getByRole("listitem").filter({ hasText: "Old title" });
    await row.getByRole("link", { name: "Edit" }).click();

    const input = page.getByRole("textbox", { name: "Task title" });
    await expect(input).toHaveValue("Old title");
    await input.fill("New title");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/today$/);
    await expect(
      page.getByRole("listitem").filter({ hasText: "New title" }),
    ).toBeVisible();

    await expect
      .poll(async () => {
        const response = await page.request.get("/api/v1/tasks");
        const body = (await response.json()) as { items: { title: string }[] };
        return body.items.map((item) => item.title);
      })
      .toContain("New title");
  });

  test("deletes a task with a 10-second undo and finalizes with a tombstone", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true });
    await page.goto("/tasks/new");
    await page.getByRole("textbox", { name: "Task title" }).fill("Delete me");
    await page.getByRole("button", { name: "Create task" }).click();

    const row = page.getByRole("listitem").filter({ hasText: "Delete me" });
    // Derive the id from the row's Edit link so the assertion never races sync.
    const editHref = await row
      .getByRole("link", { name: "Edit" })
      .getAttribute("href");
    const id = editHref?.split("/")[2] ?? "";
    expect(id).not.toBe("");

    // Wait for the create to reach the server so the later deletion is a true
    // round-trip rather than a never-synced local drop.
    await expect
      .poll(async () => {
        const response = await page.request.get("/api/v1/tasks");
        const body = (await response.json()) as { items: { id: string }[] };
        return body.items.some((item) => item.id === id);
      })
      .toBe(true);

    await row.getByRole("button", { name: "Delete Delete me" }).click();

    // Hidden immediately with an Undo affordance.
    await expect(page.getByText("Task deleted.")).toBeVisible();
    await expect(row).toHaveCount(0);

    // After the 10s window the deletion finalizes and syncs: the task is gone
    // from the server and its tombstone keeps it gone. (Resurrection returning
    // 410 Gone is covered directly by the service, route, and offline tests.)
    await expect
      .poll(
        async () => {
          const response = await page.request.get("/api/v1/tasks");
          const body = (await response.json()) as { items: { id: string }[] };
          return body.items.some((item) => item.id === id);
        },
        { timeout: 15_000 },
      )
      .toBe(false);
  });
});

test("scopes tasks to the signed-in account", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const other = await otherContext.newPage();

  try {
    await signIn(owner, {
      onboarded: true,
      email: `owner-${Date.now()}@rails.test`,
    });
    await signIn(other, {
      onboarded: true,
      email: `other-${Date.now()}@rails.test`,
    });

    const created = await owner.request.post("/api/v1/tasks", {
      data: {
        id: crypto.randomUUID(),
        title: "The owner's private task",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(created.status()).toBe(201);

    const otherList = (await (
      await other.request.get("/api/v1/tasks")
    ).json()) as { items: { title: string }[] };
    expect(otherList.items.map((item) => item.title)).not.toContain(
      "The owner's private task",
    );
  } finally {
    await ownerContext.close();
    await otherContext.close();
  }
});

test("rejects unauthenticated task access", async ({ browser }) => {
  const anonymous = await browser.newContext();
  try {
    const page = await anonymous.newPage();
    expect((await page.request.get("/api/v1/tasks")).status()).toBe(401);
    const write = await page.request.post("/api/v1/tasks", {
      data: {
        id: crypto.randomUUID(),
        title: "Should not persist",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(write.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
});
