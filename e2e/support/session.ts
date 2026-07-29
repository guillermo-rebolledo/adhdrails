import type { Page } from "@playwright/test";

export interface TestSessionOptions {
  email?: string;
  name?: string;
  onboarded?: boolean;
  timezone?: string;
  locale?: string;
}

/**
 * Establishes an authenticated session for the current browser context using
 * the test-only bootstrap endpoint, standing in for a completed Google
 * sign-in. The Better Auth cookie is stored in the shared context jar, so
 * subsequent `page.goto` calls are authenticated.
 */
export async function signIn(
  page: Page,
  options: TestSessionOptions = {},
): Promise<void> {
  const response = await page.request.post("/api/test/session", {
    data: { onboarded: true, ...options },
  });

  if (!response.ok()) {
    throw new Error(
      `Test session bootstrap failed with status ${response.status()}.`,
    );
  }
}
