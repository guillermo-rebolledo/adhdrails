import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

test("sends a signed-out visitor to Google-only sign-in", async ({ page }) => {
  await page.goto("/today");

  await expect(page).toHaveURL(/\/signin$/);
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  // Google is the only identity provider: no password flow is presented.
  await expect(page.locator("input[type='password']")).toHaveCount(0);
});

test("guides a new account through onboarding into a complete Today", async ({
  page,
}) => {
  await signIn(page, { onboarded: false });

  await page.goto("/today");
  await expect(page).toHaveURL(/\/onboarding$/);

  // Onboarding separates identity from optional Calendar authorization.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Google Calendar is optional" }),
  ).toBeVisible();

  // Skipping Calendar setup lands in a complete Today fallback.
  await page
    .getByRole("button", { name: "Skip for now — go to Today" })
    .click();

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});

test("keeps an onboarded account without Calendar in the full app", async ({
  page,
}) => {
  await signIn(page, { onboarded: true });

  await page.goto("/today");

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});

test("lets an account edit its timezone and locale later", async ({ page }) => {
  await signIn(page, {
    onboarded: true,
    timezone: "America/New_York",
    locale: "en-US",
  });

  await page.goto("/settings");
  const timezone = page.getByRole("textbox", { name: "Time zone" });
  await expect(timezone).toHaveValue("America/New_York");

  await timezone.fill("");
  await timezone.pressSequentially("Europe/Madrid");
  await expect(timezone).toHaveValue("Europe/Madrid");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  await page.goto("/settings");
  await expect(page.getByRole("textbox", { name: "Time zone" })).toHaveValue(
    "Europe/Madrid",
  );
});

test("scopes the account API to the signed-in session", async ({ page }) => {
  // Ownership: an anonymous request cannot read an account.
  const anonymous = await page.request.get("/api/v1/account");
  expect(anonymous.status()).toBe(401);

  const email = `owner-${Date.now()}@rails.test`;
  await signIn(page, { onboarded: true, email });

  const mine = await page.request.get("/api/v1/account");
  expect(mine.status()).toBe(200);
  await expect(mine.json()).resolves.toMatchObject({ email });
});

test("onboarding is operable with the keyboard", async ({ page }) => {
  await signIn(page, { onboarded: false });
  await page.goto("/onboarding");

  const continueButton = page.getByRole("button", { name: "Continue" });
  await continueButton.focus();
  await expect(continueButton).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Google Calendar is optional" }),
  ).toBeVisible();
});
