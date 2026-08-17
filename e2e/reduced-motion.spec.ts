import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn } from "./support/session";

// Motion-sensitive users (spec user story 124) must get an experience with
// spatial movement removed or substituted, while both themes stay readable
// (WCAG 2.2 AA). These journeys run with the platform-level reduced-motion
// preference emulated so the app's `prefers-reduced-motion` handling is
// exercised end to end.
test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("neutralizes spatial enter/exit motion globally", async ({ page }) => {
    await signIn(page, { onboarded: true });
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

    // The global guard resets tw-animate-css's spatial inputs (slide/zoom/
    // rotate) to their neutral values so keyframed overlays cross-fade in
    // place instead of translating or scaling. Opacity is intentionally left
    // untouched so the fade — which aids comprehension — survives.
    const spatialTokens = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return {
        translateY: style.getPropertyValue("--tw-enter-translate-y").trim(),
        scale: style.getPropertyValue("--tw-enter-scale").trim(),
        rotate: style.getPropertyValue("--tw-enter-rotate").trim(),
      };
    });
    expect(spatialTokens).toEqual({
      translateY: "0",
      scale: "1",
      rotate: "0",
    });
  });

  test("opens the command menu without a sliding transition", async ({
    page,
  }) => {
    await signIn(page, { onboarded: true });
    await page.goto("/today");

    // The launcher is the one entry point available on every viewport and
    // engine (no hardware keyboard required on mobile WebKit).
    await page.getByRole("button", { name: "Open command menu" }).click();
    const palette = page.getByRole("dialog", { name: "Command menu" });
    await expect(palette).toBeVisible();

    // The transition-driven panel drops its transition entirely under reduced
    // motion, so it appears in place rather than scaling/fading over time.
    await expect(palette).toHaveCSS("transition-property", "none");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`keeps the ${theme} theme readable with no WCAG A or AA issues`, async ({
      page,
    }) => {
      await page.addInitScript((selectedTheme) => {
        window.localStorage.setItem("theme", selectedTheme);
      }, theme);
      await signIn(page, { onboarded: true });
      await page.goto("/today");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();

      expect(results.violations).toEqual([]);
    });
  }
});
