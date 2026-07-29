import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

/** Drives the connect use case through the test-only helper (fake Google adapter). */
async function connectCalendar(page: import("@playwright/test").Page) {
  const response = await page.request.post("/api/test/calendar/connect");
  expect(response.ok()).toBe(true);
}

test("keeps Calendar optional: an unconnected account can still connect and use Rails", async ({
  page,
}) => {
  await signIn(page, { onboarded: true });

  await page.goto("/settings");

  // Fallback: the account works without Calendar, and connecting is on offer.
  const connect = page.getByTestId("connect-calendar");
  await expect(connect).toHaveAttribute(
    "href",
    "/api/calendar/authorize?return=/settings",
  );

  // Account functionality is unaffected by the absence of a connection.
  const account = await page.request.get("/api/v1/account");
  expect(account.status()).toBe(200);
});

test("requires authentication for the connection API", async ({ page }) => {
  const anonymous = await page.request.get("/api/v1/calendar/connection");
  expect(anonymous.status()).toBe(401);
});

test("connects, configures calendars, adopts the primary timezone, and disconnects", async ({
  page,
}) => {
  await signIn(page, { onboarded: true, timezone: "UTC", locale: "en-US" });
  await connectCalendar(page);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Calendars" })).toBeVisible();
  await expect(page.getByText("Connected.", { exact: false })).toBeVisible();

  // Target calendars by their row rather than by position.
  const writableFor = (summary: string) =>
    page
      .getByRole("listitem")
      .filter({ hasText: summary })
      .getByRole("radio", { name: /new events here/i });

  // A read-only shared calendar cannot be chosen as the write destination.
  await expect(writableFor("Personal")).toBeEnabled();
  await expect(writableFor("Holidays")).toBeDisabled();

  // Move the writable calendar to the Team calendar and save.
  await writableFor("Team").check();
  await page.getByRole("button", { name: "Save calendars" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // The selection persists across a reload.
  await page.goto("/settings");
  await expect(writableFor("Team")).toBeChecked();

  // Adopt the primary calendar's timezone, which differs from the account's.
  const adopt = page.getByRole("button", { name: /Use America\/New_York/ });
  await adopt.click();
  // The offer disappears once the timezone is adopted and the view refreshes.
  await expect(adopt).toBeHidden();
  await page.goto("/settings");
  await expect(page.getByRole("textbox", { name: "Time zone" })).toHaveValue(
    "America/New_York",
  );

  // Disconnecting keeps login and returns to the connect offer.
  await page
    .getByRole("button", { name: "Disconnect Google Calendar" })
    .click();
  await page.getByRole("button", { name: /^Disconnect$/ }).click();

  await expect(page.getByTestId("connect-calendar")).toBeVisible();
  const account = await page.request.get("/api/v1/account");
  expect(account.status()).toBe(200);
});

test("the connected Calendar settings have no accessibility violations", async ({
  page,
}) => {
  await signIn(page, { onboarded: true, timezone: "America/New_York" });
  await connectCalendar(page);
  await page.goto("/settings");
  await expect(page.getByText("Connected.", { exact: false })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("shows a calm cue when Calendar access is denied", async ({ page }) => {
  await signIn(page, { onboarded: true });

  await page.goto("/settings?calendar=denied");

  await expect(page.getByRole("status").first()).toContainText(
    /works fully without Calendar access/i,
  );
  await expect(page.getByTestId("connect-calendar")).toBeVisible();
});
