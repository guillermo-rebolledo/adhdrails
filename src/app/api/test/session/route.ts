import { eq } from "drizzle-orm";

import {
  deriveInitialLocale,
  deriveInitialTimeZone,
} from "@/domain/account/onboarding";
import { getTestAuth } from "@/server/auth";
import { getDatabase } from "@/server/db/connection";
import { user } from "@/server/db/schema";

/**
 * Test-only session bootstrap. Mounted only when `APP_ENV=test`, it stands in
 * for a completed Google sign-in so Playwright can exercise session, ownership,
 * onboarding, and fallback behaviour without real Google OAuth. It returns the
 * Better Auth session cookie signed with the same secret the app verifies.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.APP_ENV !== "test") {
    return new Response("Not found", { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
    onboarded?: boolean;
    timezone?: string;
    locale?: string;
  };

  const email = body.email ?? `test-${crypto.randomUUID()}@rails.test`;
  const name = body.name ?? "Test Account";

  const response = await getTestAuth().api.signUpEmail({
    body: { email, name, password: "test-password-1234" },
    asResponse: true,
  });

  if (!response.ok) {
    return response;
  }

  const updates: Partial<typeof user.$inferInsert> = { updatedAt: new Date() };
  if (body.onboarded) {
    updates.onboardingCompletedAt = new Date();
  }
  if (body.timezone) {
    updates.timezone = deriveInitialTimeZone(body.timezone);
  }
  if (body.locale) {
    updates.locale = deriveInitialLocale(body.locale);
  }

  await getDatabase().update(user).set(updates).where(eq(user.email, email));

  return response;
}
