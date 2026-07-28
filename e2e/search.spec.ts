import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

test.describe("global search", () => {
  test("finds and opens ranked domain content with keyboard navigation", async ({
    page,
    browserName,
  }) => {
    await signIn(page, {
      onboarded: true,
      email: `search-ranking-${browserName}@rails.test`,
    });
    const taskId = crypto.randomUUID();
    expect(
      (
        await page.request.post("/api/v1/tasks", {
          data: {
            id: taskId,
            title: "Quarterly planning report",
            idempotencyKey: crypto.randomUUID(),
          },
        })
      ).status(),
    ).toBe(201);

    await page.goto("/search");
    const search = page.getByRole("combobox", {
      name: "Search your Rails content",
    });
    await search.fill("quaterly");
    await expect(
      page.getByRole("option", { name: /Quarterly planning report/ }),
    ).toBeVisible();
    await search.press("ArrowDown");
    await search.press("Enter");

    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}/edit$`));
  });

  test("falls back to synchronized Dexie content offline and remains accessible", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "Offline emulation is Chromium-only.",
    );
    await signIn(page, {
      onboarded: true,
      email: `search-offline-${browserName}@rails.test`,
    });
    await page.goto("/thoughts/new");
    await page.getByLabel("Title").fill("Conference reference");
    await page.getByLabel("Notes").fill("Questions for the speaker");
    await page.getByRole("button", { name: "Save Thought" }).click();
    await page.goto("/search");

    await context.setOffline(true);
    await page
      .getByRole("combobox", { name: "Search your Rails content" })
      .fill("conferance");
    await expect(page.getByText("Offline results")).toBeVisible();
    await expect(
      page.getByRole("option", { name: /Conference reference/ }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test("search never exposes another account's content", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const other = await otherContext.newPage();

  try {
    await signIn(owner, {
      onboarded: true,
      email: `search-owner-${Date.now()}@rails.test`,
    });
    await signIn(other, {
      onboarded: true,
      email: `search-other-${Date.now()}@rails.test`,
    });
    await owner.request.post("/api/v1/thoughts", {
      data: {
        id: crypto.randomUUID(),
        title: "Private launch phrase",
        body: "",
        sourceInboxItemId: null,
        idempotencyKey: crypto.randomUUID(),
      },
    });

    const response = await other.request.post("/api/v1/search", {
      data: { query: "private launch" },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()) as { items: unknown[] }).toMatchObject({
      items: [],
    });
  } finally {
    await ownerContext.close();
    await otherContext.close();
  }
});
