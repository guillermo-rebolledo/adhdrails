import { z } from "zod";

import { accountProfileSchema } from "@/domain/account/onboarding";

import type { AccountProfile, AccountRepository } from "./repository";

export type AccountResult =
  | { ok: true; profile: AccountProfile }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> };

/**
 * Owns the account profile use cases: validating input, applying the
 * account-scoped repository operation, and reporting a domain-level outcome.
 * Route handlers translate that outcome to HTTP; the repository stays a pure
 * data-access seam.
 */
export function createAccountService(repository: AccountRepository) {
  async function apply(
    userId: string,
    rawInput: unknown,
    operation: (
      userId: string,
      input: z.infer<typeof accountProfileSchema>,
    ) => Promise<AccountProfile | null>,
  ): Promise<AccountResult> {
    const parsed = accountProfileSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "invalid",
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
      };
    }

    const profile = await operation(userId, parsed.data);
    return profile ? { ok: true, profile } : { ok: false, reason: "not_found" };
  }

  return {
    async getProfile(userId: string): Promise<AccountResult> {
      const profile = await repository.getProfile(userId);
      return profile
        ? { ok: true, profile }
        : { ok: false, reason: "not_found" };
    },

    updateProfile(userId: string, rawInput: unknown): Promise<AccountResult> {
      return apply(userId, rawInput, repository.updateProfile);
    },

    completeOnboarding(
      userId: string,
      rawInput: unknown,
    ): Promise<AccountResult> {
      return apply(userId, rawInput, repository.completeOnboarding);
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
