import { z } from "zod";

import {
  THOUGHT_TOMBSTONE_RETENTION_DAYS,
  thoughtCreateRequestSchema,
  thoughtDeletionRequestSchema,
  thoughtMutationRequestSchema,
} from "@/domain/thought/thought";

import type { ThoughtRecord, ThoughtRepository } from "./repository";

export type ThoughtResult =
  | { ok: true; thought: ThoughtRecord; created?: boolean }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; current: ThoughtRecord };

function invalid(error: z.ZodError): ThoughtResult {
  return {
    ok: false,
    reason: "invalid",
    fieldErrors: z.flattenError(error).fieldErrors,
  };
}

export function createThoughtService(repository: ThoughtRepository) {
  async function applyMutation(
    userId: string,
    id: string,
    rawInput: unknown,
    kind: "update" | "delete",
  ): Promise<ThoughtResult> {
    const parsed =
      kind === "update"
        ? thoughtMutationRequestSchema.safeParse(rawInput)
        : thoughtDeletionRequestSchema.safeParse(rawInput);
    if (!parsed.success) return invalid(parsed.error);

    const current = await repository.getById(userId, id);
    if (!current) return { ok: false, reason: "not_found" };
    if (current.lastMutationKey === parsed.data.idempotencyKey) {
      return { ok: true, thought: current };
    }
    if (current.version !== parsed.data.baseVersion) {
      return { ok: false, reason: "conflict", current };
    }

    const thought = await repository.mutate(userId, id, parsed.data);
    return thought
      ? { ok: true, thought }
      : { ok: false, reason: "conflict", current };
  }

  return {
    async create(userId: string, rawInput: unknown): Promise<ThoughtResult> {
      const parsed = thoughtCreateRequestSchema.safeParse(rawInput);
      if (!parsed.success) return invalid(parsed.error);

      const existing = await repository.getById(userId, parsed.data.id);
      if (existing) {
        return existing.lastMutationKey === parsed.data.idempotencyKey
          ? { ok: true, thought: existing, created: false }
          : { ok: false, reason: "conflict", current: existing };
      }
      return {
        ok: true,
        thought: await repository.insert(userId, parsed.data),
        created: true,
      };
    },

    async listForAccount(userId: string) {
      const cutoff = new Date(
        Date.now() - THOUGHT_TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      await repository.purgeDeletedBefore(userId, cutoff);
      return repository.listForAccount(userId);
    },

    async get(userId: string, id: string): Promise<ThoughtResult> {
      const thought = await repository.getById(userId, id);
      return thought
        ? { ok: true, thought }
        : { ok: false, reason: "not_found" };
    },

    update(userId: string, id: string, rawInput: unknown) {
      return applyMutation(userId, id, rawInput, "update");
    },

    setDeleted(userId: string, id: string, rawInput: unknown) {
      return applyMutation(userId, id, rawInput, "delete");
    },
  };
}

export type ThoughtService = ReturnType<typeof createThoughtService>;
