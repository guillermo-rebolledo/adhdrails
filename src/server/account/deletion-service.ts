import { z } from "zod";

import {
  accountDeletionRequestSchema,
  type AccountDeletionStatusResponse,
} from "@/domain/account/deletion";

import type { AccountDeletionDispatcher } from "./deletion-dispatcher";
import { serializeAccountDeletionStatus } from "./deletion-http";
import type { AccountDeletionRepository } from "./deletion-repository";

export interface AccountDeletionServiceDependencies {
  repository: AccountDeletionRepository;
  dispatcher: AccountDeletionDispatcher;
  now?: () => Date;
}

export type RequestAccountDeletionResult =
  | {
      ok: true;
      created: boolean;
      status: AccountDeletionStatusResponse;
    }
  | {
      ok: false;
      reason: "invalid";
      fieldErrors: Record<string, string[]>;
    };

/** Validates typed confirmation and durably disables an account before cleanup. */
export function createAccountDeletionService(
  deps: AccountDeletionServiceDependencies,
) {
  const { repository, dispatcher, now = () => new Date() } = deps;

  return {
    async getStatus(id: string): Promise<AccountDeletionStatusResponse | null> {
      const record = await repository.getById(id);
      return record ? serializeAccountDeletionStatus(record) : null;
    },

    async requestDeletion(
      userId: string,
      input: unknown,
      correlationId: string,
    ): Promise<RequestAccountDeletionResult> {
      const parsed = accountDeletionRequestSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }

      const { created, record } = await repository.create(
        userId,
        correlationId,
        now(),
      );
      if (created) {
        try {
          await dispatcher.dispatch({ jobId: record.id });
        } catch {
          // The durable row remains dispatchable; the scheduled drain retries it.
        }
      }

      return {
        ok: true,
        created,
        status: serializeAccountDeletionStatus(record),
      };
    },
  };
}

export type AccountDeletionService = ReturnType<
  typeof createAccountDeletionService
>;
