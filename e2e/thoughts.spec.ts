import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

test("creates, browses, edits, deletes, and undoes a Thought", async ({
  page,
}) => {
  await signIn(page, { onboarded: true });
  await page.goto("/thoughts/new");

  await page.getByLabel("Title").fill("Conference notes");
  await page.getByLabel("Notes").fill("Ask about offline-first design.");
  await page.getByRole("button", { name: "Save Thought" }).click();

  await expect(
    page.getByRole("heading", { name: "Conference notes" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Title").fill("Updated conference notes");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Updated conference notes" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Delete Thought" }).click();
  await expect(page.getByRole("status")).toContainText("Thought deleted");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByRole("heading", { name: "Updated conference notes" }),
  ).toBeVisible();
});

test("classifies an Inbox Item as a Thought", async ({ page }) => {
  await signIn(page, { onboarded: true });
  await page.goto("/today");
  await page
    .getByRole("textbox", { name: "Quick capture" })
    .fill("A reference from Inbox");
  await page.getByRole("button", { name: "Capture" }).click();
  await page.goto("/inbox");

  await page.getByRole("button", { name: "Save as Thought" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved as a Thought.");
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/v1/inbox-items");
      const body = (await response.json()) as { items: { title: string }[] };
      return body.items.map((item) => item.title);
    })
    .not.toContain("A reference from Inbox");
  await page.goto("/thoughts");

  await expect(
    page.getByRole("link", { name: /a reference from inbox/i }),
  ).toBeVisible();
});

test("creates offline and synchronizes the Thought after reconnect", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Offline emulation is Chromium-only.");
  await signIn(page, { onboarded: true });
  await page.goto("/thoughts/new");
  await context.setOffline(true);
  await page.getByLabel("Title").fill("Offline reference");
  await page.getByRole("button", { name: "Save Thought" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Thought saved on this device",
  );
  await context.setOffline(false);

  await expect
    .poll(async () => {
      const response = await page.request.get("/api/v1/thoughts");
      const body = (await response.json()) as {
        thoughts: { title: string }[];
      };
      return body.thoughts.map((thought) => thought.title);
    })
    .toContain("Offline reference");
});

test("keeps Thoughts private to their account", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const other = await otherContext.newPage();
  try {
    await signIn(owner, {
      onboarded: true,
      email: `thought-owner-${Date.now()}@rails.test`,
    });
    await signIn(other, {
      onboarded: true,
      email: `thought-other-${Date.now()}@rails.test`,
    });
    const response = await owner.request.post("/api/v1/thoughts", {
      data: {
        id: crypto.randomUUID(),
        title: "Private reference",
        body: "",
        sourceInboxItemId: null,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(response.status()).toBe(201);
    const otherList = (await (
      await other.request.get("/api/v1/thoughts")
    ).json()) as { thoughts: { title: string }[] };
    expect(otherList.thoughts.map((thought) => thought.title)).not.toContain(
      "Private reference",
    );
  } finally {
    await ownerContext.close();
    await otherContext.close();
  }
});

test("retains a finalized deletion as a synchronization tombstone", async ({
  page,
}) => {
  await signIn(page, { onboarded: true });
  const id = crypto.randomUUID();
  const created = await page.request.post("/api/v1/thoughts", {
    data: {
      id,
      title: "Reference to remove",
      body: "",
      sourceInboxItemId: null,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);

  const removed = await page.request.delete(`/api/v1/thoughts/${id}`, {
    data: {
      deleted: true,
      baseVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    },
  });

  expect(removed.status()).toBe(200);
  expect((await removed.json()) as { deletedAt: string | null }).toMatchObject({
    deletedAt: expect.any(String),
  });
  const list = (await (await page.request.get("/api/v1/thoughts")).json()) as {
    thoughts: { id: string; deletedAt: string | null }[];
  };
  expect(list.thoughts).toContainEqual(
    expect.objectContaining({ id, deletedAt: expect.any(String) }),
  );
});
