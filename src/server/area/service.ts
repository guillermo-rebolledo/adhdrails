import { z } from "zod";

import { areaCreateRequestSchema, resolveCreate } from "@/domain/area/area";

import type { AreaRecord, AreaRepository } from "./repository";

export type AreaCreateResult =
  | { ok: true; item: AreaRecord; created: boolean }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "conflict"; current: AreaRecord };

/**
 * Owns the Area use cases: validate a create, resolve it against the stored
 * record for its id, and report a domain-level outcome. An idempotent retry (or
 * a re-delivery of the same Area under a new key but the same name) returns the
 * stored record instead of inserting a duplicate; a genuine id collision with a
 * different name is a reviewable conflict. Route handlers translate the outcome
 * to HTTP.
 */
export function createAreaService(repository: AreaRepository) {
  return {
    async create(userId: string, rawInput: unknown): Promise<AreaCreateResult> {
      const parsed = areaCreateRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }

      const input = parsed.data;
      const existing = await repository.getById(userId, input.id);
      const resolution = resolveCreate(existing, input);

      if (resolution === "conflict") {
        return { ok: false, reason: "conflict", current: existing! };
      }
      if (resolution === "replay") {
        return { ok: true, item: existing!, created: false };
      }

      const item = await repository.insert(userId, input);
      return { ok: true, item, created: true };
    },

    listForAccount(userId: string): Promise<AreaRecord[]> {
      return repository.listForAccount(userId);
    },
  };
}

export type AreaService = ReturnType<typeof createAreaService>;
