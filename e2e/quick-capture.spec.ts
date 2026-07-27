import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

test("captures online and shows the item saved in the Inbox", async ({
  page,
}) => {
  await signIn(page, { onboarded: true });
  await page.goto("/today");

  await page
    .getByRole("textbox", { name: "Quick capture" })
    .fill("Read the release notes");
  await page.getByRole("button", { name: "Capture" }).click();

  // Accessible, local acknowledgement of the capture. Plain text has no
  // schedule, so the parser says so explicitly and offers Add details.
  await expect(page.getByRole("status")).toContainText(
    "Saved to Inbox · No schedule detected.",
  );
  await expect(page.getByRole("link", { name: "Add details" })).toBeVisible();

  await page.goto("/inbox");
  await expect(page.getByText("Read the release notes")).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("captures while offline and synchronizes on reconnect", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Offline emulation and the online event are reliable in Chromium.",
  );

  await signIn(page, { onboarded: true });
  await page.goto("/today");

  await context.setOffline(true);
  await page
    .getByRole("textbox", { name: "Quick capture" })
    .fill("Offline idea worth keeping");
  await page.getByRole("button", { name: "Capture" }).click();

  // The capture is acknowledged locally even with no connection.
  await expect(page.getByRole("status")).toContainText(
    "Saved to Inbox · No schedule detected.",
  );

  await context.setOffline(false);

  // Reconnect drains the outbox and the item reaches the server exactly once.
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/v1/inbox-items");
      const body = (await response.json()) as { items: { title: string }[] };
      return body.items.map((item) => item.title);
    })
    .toContain("Offline idea worth keeping");

  await page.goto("/inbox");
  await expect(page.getByText("Offline idea worth keeping")).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("detects a schedule, shows chips, and confirms it as an event", async ({
  page,
}) => {
  await signIn(page, { onboarded: true });
  await page.goto("/today");

  await page
    .getByRole("textbox", { name: "Quick capture" })
    .fill("Team sync tomorrow at 10am");

  // Detected values appear as editable chips before anything is classified.
  const chips = page.getByRole("list", { name: "Detected details" });
  await expect(chips).toBeVisible();
  await expect(chips).toContainText("10");

  // Confirming is the classification step: it creates a local Event carrying
  // the detected time through the offline path.
  await page.getByRole("button", { name: "Confirm as event" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Added to your calendar.",
  );
  // The field resets, ready for the next capture.
  await expect(
    page.getByRole("textbox", { name: "Quick capture" }),
  ).toHaveValue("");
});

test("delivers a duplicate capture idempotently", async ({ page }) => {
  await signIn(page, { onboarded: true });

  const body = {
    id: crypto.randomUUID(),
    title: "Only stored once",
    idempotencyKey: crypto.randomUUID(),
  };

  const first = await page.request.post("/api/v1/inbox-items", { data: body });
  expect(first.status()).toBe(201);

  // A retried delivery of the same mutation is a benign replay, not a duplicate.
  const second = await page.request.post("/api/v1/inbox-items", { data: body });
  expect(second.status()).toBe(200);

  const list = (await (
    await page.request.get("/api/v1/inbox-items")
  ).json()) as { items: { title: string }[] };
  expect(
    list.items.filter((item) => item.title === "Only stored once"),
  ).toHaveLength(1);
});

test("scopes Inbox items to the signed-in account", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const other = await otherContext.newPage();

  try {
    await signIn(owner, {
      onboarded: true,
      email: `owner-${Date.now()}@rails.test`,
    });
    await signIn(other, {
      onboarded: true,
      email: `other-${Date.now()}@rails.test`,
    });

    const captured = await owner.request.post("/api/v1/inbox-items", {
      data: {
        id: crypto.randomUUID(),
        title: "The owner's private capture",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(captured.status()).toBe(201);

    // Another account never sees it.
    const otherList = (await (
      await other.request.get("/api/v1/inbox-items")
    ).json()) as { items: { title: string }[] };
    expect(otherList.items.map((item) => item.title)).not.toContain(
      "The owner's private capture",
    );
  } finally {
    await ownerContext.close();
    await otherContext.close();
  }
});

test("rejects an unauthenticated capture", async ({ browser }) => {
  const anonymous = await browser.newContext();
  try {
    const page = await anonymous.newPage();
    const read = await page.request.get("/api/v1/inbox-items");
    expect(read.status()).toBe(401);

    const write = await page.request.post("/api/v1/inbox-items", {
      data: {
        id: crypto.randomUUID(),
        title: "Should not persist",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(write.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
});
