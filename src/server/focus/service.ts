import { z } from "zod";

import {
  type FocusSessionStatus,
  focusSessionStartRequestSchema,
  focusSessionTransitionRequestSchema,
  resolveFocusStart,
  resolveFocusTransition,
} from "@/domain/focus/session";

import {
  type FocusSessionRecord,
  type FocusSessionRepository,
  isUniqueViolation,
} from "./repository";

export type FocusStartResult =
  | { ok: true; item: FocusSessionRecord; created: boolean }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "conflict"; current: FocusSessionRecord };

export type FocusTransitionResult =
  | { ok: true; item: FocusSessionRecord; applied: boolean }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; current: FocusSessionRecord };

/**
 * Verifies a Task referenced by a Focus Session belongs to the same account. The
 * `task_id` foreign key only enforces global existence, so without this a client
 * could focus on another account's Task id.
 */
export type TaskOwnershipCheck = (
  userId: string,
  taskId: string,
) => Promise<boolean>;

const TASK_FIELD_ERROR: Record<string, string[]> = {
  taskId: ["That task could not be found."],
};

/**
 * Owns the Focus Session use cases: validate a mutation, resolve it against the
 * account's active session, and report a domain-level outcome. The account-wide
 * single-active invariant is enforced here and by the partial unique index — a
 * competing start returns a conflict carrying the session that is actually
 * active, so a second device resolves visibly rather than opening a second
 * timer. Idempotent retries return the stored record; a stale base version
 * returns a conflict so the client's local change is retained for review. Route
 * handlers translate the outcome to HTTP.
 */
export function createFocusSessionService(
  repository: FocusSessionRepository,
  now: () => Date = () => new Date(),
  taskBelongsToUser: TaskOwnershipCheck = async () => true,
) {
  return {
    async start(userId: string, rawInput: unknown): Promise<FocusStartResult> {
      const parsed = focusSessionStartRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }

      const input = parsed.data;
      if (!(await taskBelongsToUser(userId, input.taskId))) {
        return { ok: false, reason: "invalid", fieldErrors: TASK_FIELD_ERROR };
      }

      // A re-delivered start of a session we already have is a benign replay,
      // whatever its current status.
      const existing = await repository.getById(userId, input.id);
      if (existing && existing.idempotencyKey === input.idempotencyKey) {
        return { ok: true, item: existing, created: false };
      }

      const active = await repository.getActive(userId);
      const resolution = resolveFocusStart(active, {
        id: input.id,
        idempotencyKey: input.idempotencyKey,
      });
      if (resolution === "conflict") {
        return { ok: false, reason: "conflict", current: active! };
      }

      const startedAt = now();
      try {
        const item = await repository.insert(userId, {
          id: input.id,
          taskId: input.taskId,
          idempotencyKey: input.idempotencyKey,
          startedAt,
          lastResumedAt: startedAt,
        });
        return { ok: true, item, created: true };
      } catch (error) {
        // The partial unique index rejected a concurrent competing start. Re-read
        // the winner and surface it as a conflict rather than a raw failure.
        if (isUniqueViolation(error)) {
          const winner = await repository.getActive(userId);
          if (winner) {
            if (
              winner.id === input.id &&
              winner.idempotencyKey === input.idempotencyKey
            ) {
              return { ok: true, item: winner, created: false };
            }
            return { ok: false, reason: "conflict", current: winner };
          }
        }
        throw error;
      }
    },

    async transition(
      userId: string,
      id: string,
      rawInput: unknown,
    ): Promise<FocusTransitionResult> {
      const parsed = focusSessionTransitionRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }

      const input = parsed.data;
      const existing = await repository.getById(userId, id);
      const resolution = resolveFocusTransition(
        existing
          ? {
              version: existing.version,
              idempotencyKey: existing.idempotencyKey,
              status: existing.status as FocusSessionStatus,
            }
          : null,
        input,
      );

      if (resolution === "missing") {
        return { ok: false, reason: "not_found" };
      }
      if (resolution === "conflict") {
        return { ok: false, reason: "conflict", current: existing! };
      }
      if (resolution === "replay") {
        return { ok: true, item: existing!, applied: false };
      }

      // The client owns the count-up clock and sends the absolute new state; the
      // server persists it after the version check and bumps the version.
      const item = await repository.update(userId, id, {
        status: input.status,
        accumulatedSeconds: input.accumulatedSeconds,
        lastResumedAt:
          input.lastResumedAt === null ? null : new Date(input.lastResumedAt),
        completedAt:
          input.completedAt === null ? null : new Date(input.completedAt),
        distractionCount: input.distractionCount,
        version: existing!.version + 1,
        idempotencyKey: input.idempotencyKey,
      });
      return { ok: true, item, applied: true };
    },

    /** The account's active session for cross-device hydration, or null. */
    getActive(userId: string): Promise<FocusSessionRecord | null> {
      return repository.getActive(userId);
    },
  };
}

export type FocusSessionService = ReturnType<typeof createFocusSessionService>;
