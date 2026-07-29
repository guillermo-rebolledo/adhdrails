import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

/** Captures a title through Quick Capture so it lands in the local Inbox. */
async function capture(page: import("@playwright/test").Page, title: string) {
  await page.goto("/today");
  await page.getByRole("textbox", { name: "Quick capture" }).fill(title);
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Saved to Inbox",
  );
}

// The multi-step UI journeys drive engine-agnostic client logic (React, Dexie,
// the sync engine). Cross-engine parity for capture-style flows is already
// exercised by the quick-capture spec, so these run on one representative
// engine. The auth checks at the bottom are pure API round-trips and stay
// cross-browser.
test.describe("inbox processing journeys", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName !== "chromium",
      "Engine-agnostic UI flow; runs on one representative engine.",
    );
  });

  test("classifies an Inbox item as a Task", async ({ page }) => {
    await signIn(page, { onboarded: true });
    await capture(page, "Email the accountant");

    await page.goto("/inbox");
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "Email the accountant" });
    await row.getByRole("button", { name: "Turn into task" }).click();

    // It leaves the Inbox and reaches the Tasks server view exactly once.
    await expect(row).toHaveCount(0);
    await expect
      .poll(async () => {
        const response = await page.request.get("/api/v1/tasks");
        const body = (await response.json()) as { items: { title: string }[] };
        return body.items.map((item) => item.title);
      })
      .toContain("Email the accountant");
  });

  test("prefills a detected schedule and converts to a calendar Event after confirming its consequence", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true });
    await capture(page, "Lunch with Sam on 2027-03-04 at 12:30pm");

    await page.goto("/inbox");
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "Lunch with Sam" });

    // Detected date and time are prefilled as editable chips during processing.
    await expect(
      row.getByRole("list", { name: "Detected details" }),
    ).toBeVisible();

    // Converting to an Event explains the Calendar consequence before it occurs.
    await row.getByRole("button", { name: "Make an event" }).click();
    await expect(
      row.getByText(/added to your calendar as a .* event/i),
    ).toBeVisible();
    await row.getByRole("button", { name: "Add to calendar" }).click();

    await expect(page.getByRole("status").first()).toContainText(
      "Added to your calendar.",
    );
    await expect(row).toHaveCount(0);
  });

  test("classifies an Inbox item as a Thought", async ({ page }) => {
    await signIn(page, { onboarded: true });
    await capture(page, "A reference worth keeping");

    await page.goto("/inbox");
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "A reference worth keeping" });
    await row.getByRole("button", { name: "Save as Thought" }).click();

    await expect(row).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const response = await page.request.get("/api/v1/thoughts");
          const body = (await response.json()) as {
            thoughts: { title: string }[];
          };
          return body.thoughts.map((thought) => thought.title);
        },
        { timeout: 10_000 },
      )
      .toContain("A reference worth keeping");
  });

  test("skips an item without penalty, leaving it in the Inbox", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true });
    await capture(page, "Maybe read this later");

    await page.goto("/inbox");
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "Maybe read this later" });
    await row.getByRole("button", { name: "Skip" }).click();

    // Set aside for this session, but never deleted — no Inbox Zero pressure.
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Maybe read this later" }),
    ).toBeVisible();
  });

  test("deletes an Inbox item with a 10-second Undo", async ({ page }) => {
    await signIn(page, { onboarded: true });
    await capture(page, "Accidental capture");

    await page.goto("/inbox");
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "Accidental capture" });
    await row
      .getByRole("button", { name: "Delete Accidental capture" })
      .click();

    await expect(page.getByText("Inbox item deleted.")).toBeVisible();
    await expect(row).toHaveCount(0);

    // Undo restores it within the window.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Accidental capture" }),
    ).toBeVisible();
  });

  test("shows a numberless unseen badge and clears it — and the server seen state — on opening the Inbox", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true });
    await capture(page, "Notice me");

    // The badge informs without a count and is announced accessibly.
    const badge = page.getByTestId("inbox-unseen-badge").first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("New inbox items");

    // Wait for the capture to reach the server unseen before opening the Inbox.
    await expect
      .poll(async () => {
        const response = await page.request.get("/api/v1/inbox-items");
        const body = (await response.json()) as {
          items: { title: string; seen: boolean }[];
        };
        return body.items.find((item) => item.title === "Notice me")?.seen;
      })
      .toBe(false);

    await page.goto("/inbox");

    // Opening the Inbox clears the badge and persists seen to the server.
    await expect(page.getByTestId("inbox-unseen-badge")).toHaveCount(0);
    await expect
      .poll(async () => {
        const response = await page.request.get("/api/v1/inbox-items");
        const body = (await response.json()) as {
          items: { title: string; seen: boolean }[];
        };
        return body.items.find((item) => item.title === "Notice me")?.seen;
      })
      .toBe(true);
  });

  test("is operable with the keyboard alone", async ({ page }) => {
    await signIn(page, { onboarded: true });
    await capture(page, "Keyboard only");

    await page.goto("/inbox");
    const row = page.getByRole("listitem").filter({ hasText: "Keyboard only" });
    const taskButton = row.getByRole("button", { name: "Turn into task" });

    await taskButton.focus();
    await expect(taskButton).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(row).toHaveCount(0);
  });
});

test.describe("inbox processing on a narrow mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("processes an item on a small screen", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "Engine-agnostic UI flow; runs on one representative engine.",
    );
    await signIn(page, { onboarded: true });
    await capture(page, "Small screen capture");

    await page.goto("/inbox");
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "Small screen capture" });
    const thoughtButton = row.getByRole("button", { name: "Save as Thought" });
    await expect(thoughtButton).toBeVisible();
    await thoughtButton.click();

    await expect(row).toHaveCount(0);
  });
});

test("rejects unauthenticated inbox-item update and deletion", async ({
  browser,
}) => {
  const anonymous = await browser.newContext();
  try {
    const page = await anonymous.newPage();
    const id = crypto.randomUUID();

    const update = await page.request.patch(`/api/v1/inbox-items/${id}`, {
      data: {
        idempotencyKey: crypto.randomUUID(),
        baseVersion: 1,
        patch: { seen: true },
      },
    });
    expect(update.status()).toBe(401);

    const remove = await page.request.delete(`/api/v1/inbox-items/${id}`);
    expect(remove.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
});
