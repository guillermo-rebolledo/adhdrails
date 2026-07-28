import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { signIn } from "./support/session";

test("opens the command palette from the visible launcher on every viewport", async ({
  page,
}) => {
  await signIn(page, { onboarded: true });
  await page.goto("/today");

  // The launcher is the touch-friendly entry point: it must be visible without
  // a hardware keyboard, on desktop and mobile alike.
  const launcher = page.getByRole("button", { name: "Open command menu" });
  await expect(launcher).toBeVisible();
  await launcher.click();

  const palette = page.getByRole("dialog", { name: "Command menu" });
  await expect(palette).toBeVisible();
  await expect(
    palette.getByRole("combobox", { name: "Search destinations and actions" }),
  ).toBeFocused();

  // Choosing a destination navigates and dismisses the palette.
  await palette.getByRole("option", { name: /Calendar/ }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(palette).toBeHidden();
});

test("opens with the keyboard shortcut and runs a quick action", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "The mobile WebKit project has no hardware keyboard; the launcher path is covered separately.",
  );

  await signIn(page, { onboarded: true });
  await page.goto("/today");

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command menu" });
  await expect(palette).toBeVisible();

  // From the freshly opened palette, the T accelerator runs New Task.
  await page.keyboard.press("t");

  await expect(page).toHaveURL(/\/tasks\/new$/);
});

test("closes with Escape and restores focus to the launcher", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Focus restoration is asserted on the keyboard-capable projects.",
  );

  await signIn(page, { onboarded: true });
  await page.goto("/today");

  const launcher = page.getByRole("button", { name: "Open command menu" });
  await launcher.click();
  await expect(
    page.getByRole("dialog", { name: "Command menu" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command menu" })).toBeHidden();
  await expect(launcher).toBeFocused();
});

test("has no automatically detectable accessibility violations while open", async ({
  page,
}) => {
  await signIn(page, { onboarded: true });
  await page.goto("/today");

  await page.getByRole("button", { name: "Open command menu" }).click();
  await expect(
    page.getByRole("dialog", { name: "Command menu" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
