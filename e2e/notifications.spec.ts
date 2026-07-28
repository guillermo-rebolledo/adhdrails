import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

test.describe("notification capability states", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName !== "chromium",
      "Capability behavior is engine-independent and covered in component tests.",
    );
  });

  test("requests permission only after the contextual action and keeps fallback on denial", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          permission: "default",
          requestPermission: async () => {
            (
              window as typeof window & { notificationRequested?: boolean }
            ).notificationRequested = true;
            return "denied";
          },
        },
      });
      if (!window.PushManager) {
        Object.defineProperty(window, "PushManager", {
          configurable: true,
          value: class PushManager {},
        });
      }
    });
    await signIn(page, { onboarded: true });
    await page.goto("/settings");

    await expect(
      page.getByRole("button", { name: "Turn on browser reminders" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { notificationRequested?: boolean })
            .notificationRequested ?? false,
      ),
    ).toBe(false);

    await page
      .getByRole("button", { name: "Turn on browser reminders" })
      .click();

    await expect(
      page.getByText(/in-app cues will stay on/i).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { notificationRequested?: boolean })
            .notificationRequested,
      ),
    ).toBe(true);
  });

  test("hides permission-dependent controls when notifications are unsupported", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: undefined,
      });
    });
    await signIn(page, { onboarded: true });
    await page.goto("/settings");

    await expect(
      page.getByText(/browser reminders aren't available/i),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: /in-app event cue/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Turn on browser reminders" }),
    ).toHaveCount(0);
  });
});
