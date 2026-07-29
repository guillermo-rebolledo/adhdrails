import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

test("requires typed confirmation and permanently deletes the account", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings#data-privacy");

  await page.getByRole("button", { name: "Delete account" }).click();
  const permanentlyDelete = page.getByRole("button", {
    name: "Permanently delete account",
  });
  await expect(permanentlyDelete).toBeDisabled();

  await page.getByLabel(/type delete my account/i).fill("DELETE MY ACCOUNT");
  await expect(permanentlyDelete).toBeEnabled();

  await permanentlyDelete.click();
  await expect(page).toHaveURL(/\/signin\?account-deletion=confirmed/);
  const jobId = new URL(page.url()).searchParams.get("deletion");
  expect(jobId).toBeTruthy();

  const cleanup = await page.request.post("/api/test/account/deletion/run", {
    data: { jobId },
  });
  expect(cleanup.ok()).toBe(true);
  await expect(cleanup.json()).resolves.toEqual({ status: "completed" });

  const status = await page.request.get(
    `/api/v1/account/deletion/${encodeURIComponent(jobId!)}`,
  );
  expect(status.ok()).toBe(true);
  await expect(status.json()).resolves.toMatchObject({
    id: jobId,
    status: "completed",
    errorCode: null,
  });
  await expect(page.getByRole("status")).toContainText("permanently deleted", {
    timeout: 10_000,
  });

  const account = await page.request.get("/api/v1/account");
  expect(account.status()).toBe(401);
});
