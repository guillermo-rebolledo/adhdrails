import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("proves the running application can reach PostgreSQL", async ({
  request,
}) => {
  const response = await request.get("/api/v1/health");

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    status: "ok",
    checks: {
      application: "ok",
      database: "ok",
    },
  });
});

test("renders secure, responsive navigation", async ({ page }) => {
  const response = await page.goto("/today");

  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(
      page.getByRole("dialog", { name: "Navigation" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Calendar" })).toHaveAttribute(
      "href",
      "/calendar",
    );
  } else {
    const navigation = page.getByRole("navigation", { name: "Primary" });
    await expect(navigation).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: "Calendar" }),
    ).toHaveAttribute("href", "/calendar");
  }
});

test("uses System appearance by default and allows an explicit theme", async ({
  page,
}) => {
  await page.goto("/today");

  await page.getByRole("button", { name: "Choose appearance" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "System" }),
  ).toHaveAttribute("aria-checked", "true");

  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

for (const theme of ["light", "dark"] as const) {
  test(`has no automatically detectable WCAG A or AA issues in ${theme} theme`, async ({
    page,
  }) => {
    await page.addInitScript((selectedTheme) => {
      window.localStorage.setItem("theme", selectedTheme);
    }, theme);
    await page.goto("/today");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}
