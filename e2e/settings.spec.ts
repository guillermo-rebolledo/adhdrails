import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

const sections = [
  "Account",
  "Calendars",
  "Notifications",
  "Appearance",
  "Timezone",
  "Data & Privacy",
  "About & Support",
] as const;

test("provides the complete Settings hub on desktop and mobile", async ({
  page,
}) => {
  await signIn(page, { onboarded: true });
  await page.goto("/settings");

  for (const section of sections) {
    await expect(
      page.getByRole("heading", { name: section, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: section })).toHaveAttribute(
      "href",
      `#${section.toLowerCase().replaceAll(" & ", "-").replaceAll(" ", "-")}`,
    );
  }
});

test("persists appearance choices from Settings", async ({ page }) => {
  await signIn(page, { onboarded: true });
  await page.goto("/settings");

  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("changes planning locale without rewriting Event instants or timezone meaning", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "The persistence boundary is engine-independent.",
  );
  await signIn(page, {
    onboarded: true,
    timezone: "America/New_York",
    locale: "en-US",
  });
  const id = crypto.randomUUID();
  const startAt = "2027-01-20T14:00:00.000Z";
  const endAt = "2027-01-20T14:30:00.000Z";
  const created = await page.request.post("/api/v1/events", {
    data: {
      id,
      title: "Timezone boundary",
      startAt,
      endAt,
      startTimeZone: "America/New_York",
      endTimeZone: "America/New_York",
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);

  const updated = await page.request.patch("/api/v1/account", {
    data: { timezone: "Europe/Madrid", locale: "de-DE" },
  });
  expect(updated.status()).toBe(200);
  await expect(updated.json()).resolves.toMatchObject({
    timezone: "Europe/Madrid",
    locale: "de-DE",
  });

  const events = await page.request.get(
    "/api/v1/events?from=2027-01-20T00:00:00.000Z&to=2027-01-21T00:00:00.000Z",
  );
  const body = (await events.json()) as {
    items: {
      id: string;
      startAt: string;
      endAt: string;
      startTimeZone: string;
      endTimeZone: string;
    }[];
  };
  expect(body.items.find((event) => event.id === id)).toMatchObject({
    startAt,
    endAt,
    startTimeZone: "America/New_York",
    endTimeZone: "America/New_York",
  });
});

test("is keyboard and screen-reader operable", async ({ page }) => {
  await signIn(page, { onboarded: true });
  await page.goto("/settings");

  const appearanceLink = page.getByRole("link", { name: "Appearance" });
  await appearanceLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#appearance$/);
  await expect(
    page.getByRole("group", { name: "Choose appearance" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Settings sections" }),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`has no detectable accessibility or contrast violations in ${theme} appearance`, async ({
    page,
  }) => {
    await page.addInitScript((selectedTheme) => {
      window.localStorage.setItem("theme", selectedTheme);
    }, theme);
    await signIn(page, { onboarded: true });
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
