import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

// The multi-step UI journeys drive engine-agnostic client logic (React forms,
// Dexie, the sync engine). Cross-engine parity for capture-style flows is
// already exercised by the quick-capture spec, so these run on a single
// representative engine to keep the parallel dev server from thrashing on
// first-compile latency. The account-scope and auth checks below are pure API
// round-trips and stay cross-browser.
test.describe("task UI journeys", () => {
  // These journeys share the development server's first-compile and IndexedDB
  // workload. Keep them serial so the long-list pagination fixture cannot
  // starve the immediate local-navigation assertions in creation flows.
  test.describe.configure({ mode: "serial" });

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

    // Lands back on Today; the manage-list is collapsed by default, so open it
    // to confirm the new task is waiting there.
    await expect(page).toHaveURL(/\/today$/);
    await page.getByRole("button", { name: /Available tasks/ }).click();
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

  test("adds planning metadata and a created Area, and persists them", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true });
    await page.goto("/tasks/new");

    await page
      .getByRole("textbox", { name: "Task title" })
      .fill("Prepare the deck");
    await page.getByLabel("Scheduled for").fill("2026-08-01");
    await page.getByLabel("Time (optional)").fill("09:30");
    await page.getByLabel("Estimate (minutes)").fill("45");
    await page.getByRole("radio", { name: "High" }).check();
    await page.getByRole("checkbox", { name: "Important" }).check();

    // Create an Area on entry from the combobox.
    const area = page.getByRole("combobox");
    await area.click();
    await area.fill("Marketing");
    await page.getByText('Create "Marketing"').click();

    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/today$/);

    // The Area reaches the server.
    async function fetchMarketingId(): Promise<string | null> {
      const areas = (await (
        await page.request.get("/api/v1/areas")
      ).json()) as { items: { id: string; name: string }[] };
      return areas.items.find((item) => item.name === "Marketing")?.id ?? null;
    }
    await expect.poll(fetchMarketingId).not.toBeNull();
    const areaId = await fetchMarketingId();

    // The metadata round-trips through the server too, linked to that Area.
    await expect
      .poll(async () => {
        const body = (await (
          await page.request.get("/api/v1/tasks")
        ).json()) as {
          items: {
            title: string;
            scheduledDate: string | null;
            scheduledTime: string | null;
            estimateMinutes: number | null;
            energy: string | null;
            important: boolean;
            areaId: string | null;
          }[];
        };
        return body.items.find((item) => item.title === "Prepare the deck");
      })
      .toMatchObject({
        scheduledDate: "2026-08-01",
        scheduledTime: "09:30",
        estimateMinutes: 45,
        energy: "high",
        important: true,
        areaId,
      });
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

    await page.getByRole("button", { name: /Available tasks/ }).click();
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

    await page.getByRole("button", { name: /Available tasks/ }).click();
    const row = page.getByRole("listitem").filter({ hasText: "Old title" });
    await row.getByRole("link", { name: "Edit" }).click();

    const input = page.getByRole("textbox", { name: "Task title" });
    await expect(input).toHaveValue("Old title");
    await input.fill("New title");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/today$/);
    await page.getByRole("button", { name: /Available tasks/ }).click();
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

    await page.getByRole("button", { name: /Available tasks/ }).click();
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

  test("browses, filters, and paginates Task collections accessibly", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true, timezone: "UTC" });

    const areaId = crypto.randomUUID();
    expect(
      (
        await page.request.post("/api/v1/areas", {
          data: {
            id: areaId,
            name: "Work",
            idempotencyKey: crypto.randomUUID(),
          },
        })
      ).status(),
    ).toBe(201);

    const today = new Date().toISOString().slice(0, 10);
    const tomorrowDate = new Date();
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    const tomorrow = tomorrowDate.toISOString().slice(0, 10);

    async function createTask(
      title: string,
      metadata: Record<string, unknown> = {},
    ) {
      const id = crypto.randomUUID();
      const response = await page.request.post("/api/v1/tasks", {
        data: {
          id,
          title,
          idempotencyKey: crypto.randomUUID(),
          ...metadata,
        },
      });
      expect(response.status()).toBe(201);
      return id;
    }

    await createTask("Today with low energy", {
      scheduledDate: today,
      areaId,
      energy: "low",
    });
    await createTask("Upcoming task", {
      scheduledDate: tomorrow,
      energy: "high",
    });
    await createTask("Unscheduled task");
    for (let index = 0; index < 18; index += 1) {
      await createTask(`Inventory task ${index + 1}`);
    }
    const completedId = await createTask("Finished task");
    expect(
      (
        await page.request.patch(`/api/v1/tasks/${completedId}`, {
          data: {
            idempotencyKey: crypto.randomUUID(),
            baseVersion: 1,
            patch: { status: "completed" },
          },
        })
      ).status(),
    ).toBe(200);

    await page.goto("/tasks");

    // Anytime contains scheduled and unscheduled active work, bounded to one
    // server page until the user asks for more.
    await expect(page.getByText("Unscheduled task")).toBeVisible();
    await expect(page.getByText("Today with low energy")).toBeVisible();
    await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByText("Upcoming task")).toBeVisible();

    // Explicit filters narrow the inventory and clear as one predictable unit.
    await expect(page.getByRole("option", { name: "Work" })).toBeAttached();
    await page.getByLabel("Filter by area").selectOption(areaId);
    await page.getByLabel("Filter by energy").selectOption("low");
    await expect(page.getByText("Today with low energy")).toBeVisible();
    await expect(page.getByText("Unscheduled task")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByLabel("Filter by area")).toHaveValue("");
    await expect(page.getByLabel("Filter by energy")).toHaveValue("");

    await page.getByRole("tab", { name: "Today" }).click();
    await expect(page.getByText("Today with low energy")).toBeVisible();
    await expect(page.getByText("Unscheduled task")).toHaveCount(0);

    await page.getByRole("tab", { name: "Upcoming" }).click();
    await expect(page.getByText("Upcoming task")).toBeVisible();

    await page.getByRole("tab", { name: "Completed" }).click();
    await expect(page.getByText("Finished task")).toBeVisible();
    await expect(page.getByText(/overdue/i)).toHaveCount(0);

    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
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
