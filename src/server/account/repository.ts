import { eq } from "drizzle-orm";

import type { AccountProfileInput } from "@/domain/account/onboarding";
import type { Database } from "@/server/db/connection";
import { user } from "@/server/db/schema";

export interface AccountProfile {
  userId: string;
  email: string;
  name: string;
  timezone: string;
  locale: string;
  onboardingCompletedAt: Date | null;
}

const profileColumns = {
  userId: user.id,
  email: user.email,
  name: user.name,
  timezone: user.timezone,
  locale: user.locale,
  onboardingCompletedAt: user.onboardingCompletedAt,
};

/**
 * Account-scoped access to the profile fields Rails owns on top of Better
 * Auth's identity. Every operation is keyed by `userId`, so a caller can only
 * ever read or mutate its own account.
 */
export function createAccountRepository(database: Database) {
  return {
    async getProfile(userId: string): Promise<AccountProfile | null> {
      const [row] = await database
        .select(profileColumns)
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);

      return row ?? null;
    },

    async updateProfile(
      userId: string,
      input: AccountProfileInput,
    ): Promise<AccountProfile | null> {
      const [row] = await database
        .update(user)
        .set({
          timezone: input.timezone,
          locale: input.locale,
          updatedAt: new Date(),
        })
        .where(eq(user.id, userId))
        .returning(profileColumns);

      return row ?? null;
    },

    async completeOnboarding(
      userId: string,
      input: AccountProfileInput,
    ): Promise<AccountProfile | null> {
      const [row] = await database
        .update(user)
        .set({
          timezone: input.timezone,
          locale: input.locale,
          onboardingCompletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(user.id, userId))
        .returning(profileColumns);

      return row ?? null;
    },
  };
}

export type AccountRepository = ReturnType<typeof createAccountRepository>;
