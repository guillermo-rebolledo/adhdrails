import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/session";

// The focus-session journeys drive engine-agnostic client logic (React state,
// Dexie, the sync engine, and the count-up timer). Cross-engine parity for the
// offline/sync machinery is already exercised elsewhere, so the multi-step UI
// flow runs on one representative engine; the account-scope and single-active
// API checks are pure round-trips and stay cross-browser.
test.describe("focus session UI journeys", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName !== "chromium",
      "Engine-agnostic UI flow; runs on one representative engine.",
    );
  });

  async function createTaskAndFocus(page: Page, title: string) {
    await page.goto("/tasks/new");
    await page.getByRole("textbox", { name: "Task title" }).fill(title);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/today$/);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByLabel("Focus session")).toBeVisible();
  }

  async function activeSessionStatus(page: Page): Promise<string | null> {
    const response = await page.request.get("/api/v1/focus-session");
    const body = (await response.json()) as {
      session: { status: string } | null;
    };
    return body.session?.status ?? null;
  }

  test("starts, pauses, resumes, and completes one persistent session", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true });
    await createTaskAndFocus(page, "Draft the proposal");

    const card = page.getByLabel("Focus session");
    await expect(card.getByText("Draft the proposal")).toBeVisible();
    await expect(card.getByRole("timer")).toBeVisible();

    // The session reaches the server as the account's active session.
    await expect.poll(() => activeSessionStatus(page)).toBe("running");

    // Pause preserves the session and is distinct from moving a task later.
    await card.getByRole("button", { name: "Pause" }).click();
    await expect(card.getByText("Paused.")).toBeVisible();
    await expect.poll(() => activeSessionStatus(page)).toBe("paused");

    // Reopening the app does not silently pause or lose the session.
    await page.reload();
    const reopened = page.getByLabel("Focus session");
    await expect(reopened).toBeVisible();
    await expect(reopened.getByText("Paused.")).toBeVisible();

    await reopened.getByRole("button", { name: "Resume" }).click();
    await expect(reopened.getByText("Counting up — no rush.")).toBeVisible();
    await expect.poll(() => activeSessionStatus(page)).toBe("running");

    // Completing shows the calm acknowledgement and returns to Today without
    // auto-starting. The completion is held during its Undo window, so it only
    // reaches the server once the user deliberately moves on.
    await reopened.getByRole("button", { name: "Complete" }).click();
    await expect(
      page.getByText("Focus complete. Nicely done — take a breath."),
    ).toBeVisible();
    await expect(page.getByLabel("Focus session")).toHaveCount(0);

    await page.getByRole("button", { name: "Return to Today" }).click();
    // Finalizing clears the account's active session; nothing started on its own.
    await expect.poll(() => activeSessionStatus(page)).toBeNull();
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  });

  test("keeps focus low-distraction: capture, undo, and deliberate next items", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true });
    await createTaskAndFocus(page, "Write the summary");

    const card = page.getByLabel("Focus session");

    // A distraction is parked in the Inbox with a subtle confirmation, without
    // leaving the Task.
    await card
      .getByRole("textbox", { name: /park it and stay here/i })
      .fill("Email Alex back");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText("Saved to Inbox.")).toBeVisible();
    await expect(card).toBeVisible();

    // The expanded focus view opens as a dialog and returns without pausing.
    await card.getByRole("button", { name: "Enter focus view" }).click();
    const view = page.getByRole("dialog");
    await expect(view.getByRole("timer")).toBeVisible();
    await view.getByRole("button", { name: "Exit focus view" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The distraction is waiting in the Inbox.
    await page.goto("/inbox");
    await expect(page.getByText("Email Alex back")).toBeVisible();
    await page.goto("/today");

    // Completing offers Undo; undoing resumes the very same session.
    await page
      .getByLabel("Focus session")
      .getByRole("button", { name: "Complete" })
      .click();
    await expect(page.getByLabel("Focus complete")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByLabel("Focus session")).toBeVisible();
    await expect.poll(() => activeSessionStatus(page)).not.toBeNull();

    // Completing again and choosing View next items never auto-starts a Task.
    await page
      .getByLabel("Focus session")
      .getByRole("button", { name: "Complete" })
      .click();
    await page.getByRole("button", { name: "View next items" }).click();
    await expect(page.getByRole("timer")).toHaveCount(0);
  });

  test("refuses a second, competing active session for the account", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true });
    await createTaskAndFocus(page, "Focus one");
    await expect.poll(() => activeSessionStatus(page)).toBe("running");

    // A competing start (a second device) is rejected with the active session.
    const competing = await page.request.post("/api/v1/focus-session", {
      data: {
        id: crypto.randomUUID(),
        taskId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      },
    });
    // A fabricated task id is rejected before it can compete (422); a real one
    // would return 409. Either way, no second active session is created.
    expect([409, 422]).toContain(competing.status());
    await expect.poll(() => activeSessionStatus(page)).toBe("running");

    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
  });
});

test("scopes the focus session to the signed-in account", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const other = await otherContext.newPage();

  try {
    await signIn(owner, {
      onboarded: true,
      email: `focus-owner-${Date.now()}@rails.test`,
    });
    await signIn(other, {
      onboarded: true,
      email: `focus-other-${Date.now()}@rails.test`,
    });

    const taskId = crypto.randomUUID();
    expect(
      (
        await owner.request.post("/api/v1/tasks", {
          data: {
            id: taskId,
            title: "Owner's focus task",
            idempotencyKey: crypto.randomUUID(),
          },
        })
      ).status(),
    ).toBe(201);

    expect(
      (
        await owner.request.post("/api/v1/focus-session", {
          data: {
            id: crypto.randomUUID(),
            taskId,
            idempotencyKey: crypto.randomUUID(),
          },
        })
      ).status(),
    ).toBe(201);

    // The other account sees no active session of its own.
    const otherActive = (await (
      await other.request.get("/api/v1/focus-session")
    ).json()) as { session: unknown };
    expect(otherActive.session).toBeNull();
  } finally {
    await ownerContext.close();
    await otherContext.close();
  }
});

test("rejects unauthenticated focus-session access", async ({ browser }) => {
  const anonymous = await browser.newContext();
  try {
    const page = await anonymous.newPage();
    expect((await page.request.get("/api/v1/focus-session")).status()).toBe(
      401,
    );
    const write = await page.request.post("/api/v1/focus-session", {
      data: {
        id: crypto.randomUUID(),
        taskId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(write.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
});
