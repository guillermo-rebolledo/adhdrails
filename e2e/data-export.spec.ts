import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

/** Reads a captured download's bytes into a string. */
async function readDownload(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

test("exports app-owned data and downloads the archive end to end", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "The export pipeline is engine-independent; one browser proves it.",
  );

  await signIn(page, { onboarded: true });
  await page.goto("/settings");

  // Request the export from the Data & Privacy section.
  await page.getByTestId("request-export").click();
  await expect(
    page.getByRole("status").filter({ hasText: /preparing/i }),
  ).toBeVisible();

  // Stand in for the durable Inngest exporter, then reload to see the result.
  const ran = await page.request.post("/api/test/data-export/run");
  expect(ran.ok()).toBe(true);
  await page.reload();

  const download = page.getByTestId("download-export");
  await expect(download).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await download.click();
  const archive = await downloadPromise;
  expect(archive.suggestedFilename()).toMatch(
    /^rails-export-\d{4}-\d{2}-\d{2}\.json$/,
  );

  const stream = await archive.createReadStream();
  const document = JSON.parse(await readDownload(stream));

  expect(document.schemaVersion).toBe(1);
  expect(document.account.email).toBeTruthy();
  expect(Array.isArray(document.tasks)).toBe(true);
  // Mirrored Google identifiers never appear in an app-owned export.
  expect(JSON.stringify(document)).not.toContain("googleEventId");
});

test("shows a calm offline message when an export cannot be requested", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Offline fallback messaging is engine-independent.",
  );

  await signIn(page, { onboarded: true });
  await page.goto("/settings");

  await context.setOffline(true);
  await page.getByTestId("request-export").click();

  // Scope to the Data & Privacy section: an app-wide offline banner may also be
  // an alert, and this asserts the export's own calm, actionable message.
  const dataPrivacy = page.locator("#data-privacy");
  await expect(dataPrivacy.getByRole("alert")).toHaveText(/offline/i);

  await context.setOffline(false);
});
