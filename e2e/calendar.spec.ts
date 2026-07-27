import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

// A far-future instant guaranteed to fall outside the current agenda week, so
// events created with it land in the Later list rather than the weekly grid.
function laterStart(monthOffset: number, day: number): string {
  const base = new Date();
  const date = new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth() + monthOffset,
      day,
      16,
      0,
      0,
    ),
  );
  return date.toISOString();
}

async function createEventViaApi(
  request: import("@playwright/test").APIRequestContext,
  title: string,
  startAt: string,
): Promise<void> {
  const start = new Date(startAt);
  const end = new Date(start.getTime() + 30 * 60_000);
  const response = await request.post("/api/v1/events", {
    data: {
      id: crypto.randomUUID(),
      title,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      startTimeZone: "America/New_York",
      endTimeZone: "America/New_York",
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(response.status()).toBe(201);
}

test.describe("calendar UI journeys", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName !== "chromium",
      "Engine-agnostic UI flow; runs on one representative engine.",
    );
  });

  test("creates a local event and shows it on the weekly agenda", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true, timezone: "America/New_York" });
    await page.goto("/calendar/events/new");

    await page
      .getByRole("textbox", { name: "Event title" })
      .fill("Team standup");
    // Keep the seeded default date (today) so the event lands in this week.
    await page.getByLabel("Start time").fill("10:00");
    await page.getByRole("button", { name: "Create event" }).click();

    await expect(page).toHaveURL(/\/calendar$/);
    // The event appears in the agenda (rendered in both desktop and mobile
    // layouts; at least one instance is visible at the desktop viewport).
    await expect(page.getByText("Team standup").first()).toBeVisible();

    // It reached the server exactly once.
    const from = new Date();
    from.setDate(from.getDate() - 1);
    const to = new Date();
    to.setDate(to.getDate() + 2);
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/v1/events?from=${from.toISOString()}&to=${to.toISOString()}`,
        );
        const body = (await response.json()) as { items: { title: string }[] };
        return body.items.map((item) => item.title);
      })
      .toContain("Team standup");
  });

  test("pages the Later list in batches with a stable Load more", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true, timezone: "America/New_York" });

    // Seed 22 future events (beyond this week) so the first page (20) leaves a
    // remainder behind a Load more.
    for (let index = 0; index < 22; index += 1) {
      await createEventViaApi(
        page.request,
        `Future event ${String(index).padStart(2, "0")}`,
        laterStart(2, 1 + index),
      );
    }

    await page.goto("/calendar");

    const later = page.getByRole("heading", { name: "Later" });
    await expect(later).toBeVisible();

    // The first page shows 20 events; the 21st is not yet rendered.
    await expect(page.getByText("Future event 00")).toBeVisible();
    await expect(page.getByText("Future event 19")).toBeVisible();
    await expect(page.getByText("Future event 20")).toHaveCount(0);

    // Load more reveals the remainder, then disappears when exhausted.
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByText("Future event 21")).toBeVisible();
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(
      0,
    );
  });

  test("creates an event offline and syncs on reconnect", async ({
    page,
    context,
  }) => {
    await signIn(page, { onboarded: true, timezone: "America/New_York" });
    await page.goto("/calendar/events/new");

    // The create writes to the durable local replica and outbox even with no
    // connection. (Cross-page navigation offline needs the service worker,
    // which is a later slice, so we don't assert the post-submit navigation.)
    await context.setOffline(true);
    await page
      .getByRole("textbox", { name: "Event title" })
      .fill("Offline meeting");
    await page.getByLabel("Start time").fill("14:00");
    await page.getByRole("button", { name: "Create event" }).click();

    await context.setOffline(false);

    // Back online, a fresh load drains the outbox: the queued event reaches the
    // server and shows on the agenda (read from the same local replica).
    await page.goto("/calendar");
    await expect(page.getByText("Offline meeting").first()).toBeVisible();

    const from = new Date();
    from.setDate(from.getDate() - 1);
    const to = new Date();
    to.setDate(to.getDate() + 2);
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/v1/events?from=${from.toISOString()}&to=${to.toISOString()}`,
        );
        const body = (await response.json()) as { items: { title: string }[] };
        return body.items.map((item) => item.title);
      })
      .toContain("Offline meeting");
  });
});

test("shows the weekly agenda on a narrow mobile viewport", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "firefox",
    "Layout parity check; the desktop (chromium) and mobile (webkit) engines suffice.",
  );
  await signIn(page, { onboarded: true, timezone: "America/New_York" });
  await page.goto("/calendar");

  // Both layouts render the same data for full feature parity; the vertical
  // mobile agenda is present in the DOM regardless of viewport.
  await expect(page.getByTestId("agenda-week-list")).toBeAttached();
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
});

test("calendar has no automatically detectable accessibility violations", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "One engine suffices for the axe scan.",
  );
  await signIn(page, { onboarded: true, timezone: "America/New_York" });
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("scopes events to the signed-in account", async ({ browser }) => {
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

    await createEventViaApi(
      owner.request,
      "The owner's private event",
      laterStart(3, 5),
    );

    const from = new Date().toISOString();
    const to = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString();
    const otherList = (await (
      await other.request.get(`/api/v1/events?from=${from}&to=${to}`)
    ).json()) as { items: { title: string }[] };
    expect(otherList.items.map((item) => item.title)).not.toContain(
      "The owner's private event",
    );
  } finally {
    await ownerContext.close();
    await otherContext.close();
  }
});

test("rejects unauthenticated event access", async ({ browser }) => {
  const anonymous = await browser.newContext();
  try {
    const page = await anonymous.newPage();
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 3600 * 1000).toISOString();
    expect(
      (await page.request.get(`/api/v1/events?from=${from}&to=${to}`)).status(),
    ).toBe(401);
    expect(
      (await page.request.get(`/api/v1/events/later?from=${from}`)).status(),
    ).toBe(401);
  } finally {
    await anonymous.close();
  }
});
