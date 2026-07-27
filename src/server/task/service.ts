import { z } from "zod";

import {
  resolveCompletedAt,
  resolveCreate,
  resolveUpdate,
  taskCreateRequestSchema,
  taskUpdateRequestSchema,
} from "@/domain/task/task";

import type { TaskRecord, TaskRepository } from "./repository";

export type TaskCreateResult =
  | { ok: true; item: TaskRecord; created: boolean }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "conflict"; current: TaskRecord }
  | { ok: false; reason: "gone" };

export type TaskUpdateResult =
  | { ok: true; item: TaskRecord; applied: boolean }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "conflict"; current: TaskRecord }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "gone" };

/**
 * Verifies an Area referenced by a Task belongs to the same account. The Task's
 * `area_id` foreign key only enforces global existence, so without this a client
 * could attach another account's Area id to its Task. Returns `true` when there
 * is no Area to check (unset or cleared).
 */
export type AreaOwnershipCheck = (
  userId: string,
  areaId: string,
) => Promise<boolean>;

const AREA_FIELD_ERROR: Record<string, string[]> = {
  areaId: ["That area could not be found."],
};

/**
 * Owns the Task use cases: validate a mutation, resolve it against the stored
 * world (including deletion tombstones), and report a domain-level outcome.
 * Idempotent retries return the stored record; a stale base version returns a
 * conflict so the client's local change is retained for review. A referenced
 * Area is verified to belong to the account before it is written. Route handlers
 * translate the outcome to HTTP.
 */
export function createTaskService(
  repository: TaskRepository,
  now: () => Date = () => new Date(),
  areaBelongsToUser: AreaOwnershipCheck = async () => true,
) {
  async function areaReferenceIsValid(
    userId: string,
    areaId: string | null | undefined,
  ): Promise<boolean> {
    if (areaId == null) {
      return true;
    }
    return areaBelongsToUser(userId, areaId);
  }

  return {
    async create(userId: string, rawInput: unknown): Promise<TaskCreateResult> {
      const parsed = taskCreateRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }

      const input = parsed.data;
      if (!(await areaReferenceIsValid(userId, input.areaId))) {
        return { ok: false, reason: "invalid", fieldErrors: AREA_FIELD_ERROR };
      }
      const tombstoned = await repository.isTombstoned(userId, input.id);
      const existing = await repository.getById(userId, input.id);
      const resolution = resolveCreate(existing, input, tombstoned);

      if (resolution === "gone") {
        return { ok: false, reason: "gone" };
      }
      if (resolution === "conflict") {
        return { ok: false, reason: "conflict", current: existing! };
      }
      if (resolution === "replay") {
        return { ok: true, item: existing!, created: false };
      }

      const item = await repository.insert(userId, input);
      return { ok: true, item, created: true };
    },

    async update(
      userId: string,
      id: string,
      rawInput: unknown,
    ): Promise<TaskUpdateResult> {
      const parsed = taskUpdateRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }

      const input = parsed.data;
      if (!(await areaReferenceIsValid(userId, input.patch.areaId))) {
        return { ok: false, reason: "invalid", fieldErrors: AREA_FIELD_ERROR };
      }
      const tombstoned = await repository.isTombstoned(userId, id);
      const existing = await repository.getById(userId, id);
      const resolution = resolveUpdate(existing, input, tombstoned);

      if (resolution === "gone") {
        return { ok: false, reason: "gone" };
      }
      if (resolution === "missing") {
        return { ok: false, reason: "not_found" };
      }
      if (resolution === "conflict") {
        return { ok: false, reason: "conflict", current: existing! };
      }
      if (resolution === "replay") {
        return { ok: true, item: existing!, applied: false };
      }

      const item = await repository.update(userId, id, {
        patch: input.patch,
        completedAt: resolveCompletedAt(
          existing!.completedAt,
          input.patch.status,
          now(),
        ),
        version: existing!.version + 1,
        idempotencyKey: input.idempotencyKey,
      });
      return { ok: true, item, applied: true };
    },

    /** Deletes a Task and writes its tombstone. Idempotent by construction. */
    async remove(userId: string, id: string): Promise<void> {
      await repository.remove(userId, id);
    },

    listActiveForAccount(userId: string): Promise<TaskRecord[]> {
      return repository.listActiveForAccount(userId);
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
