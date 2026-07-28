import { z } from "zod";
import { Temporal } from "temporal-polyfill";

/**
 * A Focus Session is the single active timer Rails keeps for one account. Only
 * one may be active (running or paused) at a time; completion is terminal and
 * leaves minimal history. The timer counts up rather than down, so an estimate
 * never becomes pressure. This module holds the pure state-machine and count-up
 * logic plus the request/response contracts shared by the client outbox, the API
 * routes, and their tests — it has no React, Next.js, Drizzle, or network
 * dependencies.
 *
 * Elapsed time is stored as `accumulatedSeconds` (the whole seconds folded from
 * every completed running segment) plus, while running, the live delta since
 * `lastResumedAt`. Pausing folds the open segment into the total and clears the
 * anchor; resuming opens a fresh segment without losing the total. This keeps
 * the elapsed time correct across pause/resume, navigation, and reopening on
 * another device, because the anchor and total are both server-persisted.
 */

export const FOCUS_SESSION_STATUSES = [
  "running",
  "paused",
  "completed",
] as const;
export const focusSessionStatusSchema = z.enum(FOCUS_SESSION_STATUSES);
export type FocusSessionStatus = z.infer<typeof focusSessionStatusSchema>;

/** The transitions a user can drive on an active session. */
export const FOCUS_ACTIONS = ["pause", "resume", "complete"] as const;
export const focusActionSchema = z.enum(FOCUS_ACTIONS);
export type FocusAction = z.infer<typeof focusActionSchema>;

/** A session is active while running or paused; completion is terminal. */
export function isActiveFocusStatus(status: FocusSessionStatus): boolean {
  return status !== "completed";
}

/** The timing-bearing shape the state machine reads and rewrites. */
export interface FocusSessionState {
  status: FocusSessionStatus;
  accumulatedSeconds: number;
  /** Instant the current running segment began; null when paused or completed. */
  lastResumedAt: string | null;
  completedAt: string | null;
}

function epochMs(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

/**
 * Whole seconds elapsed as of `now`: the accumulated total plus the open running
 * segment. Never negative, so a backward clock skew cannot rewind the timer.
 */
export function elapsedSeconds(state: FocusSessionState, now: string): number {
  if (state.status !== "running" || state.lastResumedAt === null) {
    return state.accumulatedSeconds;
  }
  const delta = Math.floor(
    (epochMs(now) - epochMs(state.lastResumedAt)) / 1000,
  );
  return state.accumulatedSeconds + Math.max(0, delta);
}

/**
 * Whether the count-up has reached the Task's optional estimate. An estimate is
 * informational, so a Task without one never "reaches" anything. Reaching it is
 * a cue to reassess calmly — never an overdue or failure state.
 */
export function hasReachedEstimate(
  elapsedSecondsValue: number,
  estimateMinutes: number | null,
): boolean {
  if (estimateMinutes === null || estimateMinutes <= 0) {
    return false;
  }
  return elapsedSecondsValue >= estimateMinutes * 60;
}

/**
 * The calm reassessment shown when a Focus Session passes its estimate. It never
 * says overdue, late, or failed — an estimate is a guess, not a promise. It
 * simply invites the user to keep going, take a break, or wrap up.
 */
export const FOCUS_ESTIMATE_REACHED_MESSAGE =
  "You've reached your estimate — that's just a guess, not a deadline. Keep going, take a break, or wrap up whenever you're ready.";

/** Whether `action` is legal for a session currently in `status`. */
export function isFocusActionAllowed(
  status: FocusSessionStatus,
  action: FocusAction,
): boolean {
  if (status === "completed") {
    return false;
  }
  switch (action) {
    case "pause":
      return status === "running";
    case "resume":
      return status === "paused";
    case "complete":
      return true;
  }
}

/** The initial state of a freshly started session: running from `now`. */
export function startFocusState(now: string): FocusSessionState {
  return {
    status: "running",
    accumulatedSeconds: 0,
    lastResumedAt: now,
    completedAt: null,
  };
}

/**
 * Applies a transition, folding the open running segment into the total where
 * the transition ends or interrupts it. Throws on an illegal transition; callers
 * that might act on stale state guard with {@link isFocusActionAllowed} first.
 */
export function applyFocusAction(
  state: FocusSessionState,
  action: FocusAction,
  now: string,
): FocusSessionState {
  if (!isFocusActionAllowed(state.status, action)) {
    throw new Error(`Cannot ${action} a ${state.status} focus session.`);
  }
  switch (action) {
    case "pause":
      return {
        status: "paused",
        accumulatedSeconds: elapsedSeconds(state, now),
        lastResumedAt: null,
        completedAt: null,
      };
    case "resume":
      return {
        status: "running",
        accumulatedSeconds: state.accumulatedSeconds,
        lastResumedAt: now,
        completedAt: null,
      };
    case "complete":
      return {
        status: "completed",
        accumulatedSeconds: elapsedSeconds(state, now),
        lastResumedAt: null,
        completedAt: now,
      };
  }
}

/**
 * A single offline-capable start mutation. The `id` is a client-generated UUID
 * so an offline session never needs temporary-ID remapping, and `idempotencyKey`
 * lets a retried delivery resolve to the same server record instead of a
 * duplicate. `taskId` is the Task the session is focused on.
 */
export const focusSessionStartRequestSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  idempotencyKey: z.uuid(),
});

export type FocusSessionStartRequest = z.infer<
  typeof focusSessionStartRequestSchema
>;

/**
 * A single offline-capable transition mutation. The client owns the count-up
 * clock: it computes the resulting timing with {@link applyFocusAction} and
 * sends the absolute new state, so any number of offline transitions (pause →
 * resume → complete) collapse to one last-write-wins delivery rather than an
 * un-replayable action log. `baseVersion` is the server version the client based
 * the change on; a stale base is a conflict the server reports so the local
 * change is retained for review rather than clobbering newer data (for example,
 * a session paused on another device).
 */
export const focusSessionTransitionRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  baseVersion: z.number().int().positive(),
  status: focusSessionStatusSchema,
  accumulatedSeconds: z.number().int().nonnegative(),
  lastResumedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  // The captured-distraction total carried as absolute state, so a distraction
  // captured during focus survives the same last-write-wins collapse as the
  // timing fields rather than needing a separate mutation channel.
  distractionCount: z.number().int().nonnegative(),
});

export type FocusSessionTransitionRequest = z.infer<
  typeof focusSessionTransitionRequestSchema
>;

/** Builds the transition request body for the resulting state of an action. */
export function toTransitionRequest(
  state: FocusSessionState,
  baseVersion: number,
  idempotencyKey: string,
  distractionCount: number,
): FocusSessionTransitionRequest {
  return {
    idempotencyKey,
    baseVersion,
    status: state.status,
    accumulatedSeconds: state.accumulatedSeconds,
    lastResumedAt: state.lastResumedAt,
    completedAt: state.completedAt,
    distractionCount,
  };
}

/** Server-confirmed shape of a Focus Session, shared by the serializer and UI. */
export const focusSessionResponseSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  status: focusSessionStatusSchema,
  accumulatedSeconds: z.number().int().nonnegative(),
  lastResumedAt: z.string().nullable(),
  distractionCount: z.number().int().nonnegative(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FocusSessionResponse = z.infer<typeof focusSessionResponseSchema>;

/**
 * How an incoming start resolves against the account's current active session:
 *
 * - `insert` — no session is active; persist a fresh running session.
 * - `replay` — this exact start was already applied (same id and idempotency
 *   key); return the stored session without writing again.
 * - `conflict` — a different session is already active, typically started on
 *   another device; surface it rather than opening a competing timer.
 */
export type FocusStartResolution = "insert" | "replay" | "conflict";

/** The identity-bearing fields the start resolution compares. */
export interface FocusStartState {
  id: string;
  idempotencyKey: string;
}

export function resolveFocusStart(
  active: FocusStartState | null,
  incoming: FocusStartState,
): FocusStartResolution {
  if (active === null) {
    return "insert";
  }
  if (
    active.id === incoming.id &&
    active.idempotencyKey === incoming.idempotencyKey
  ) {
    return "replay";
  }
  return "conflict";
}

/**
 * How an incoming transition resolves against the stored session:
 *
 * - `missing` — no such session for this account.
 * - `replay` — this exact transition was already applied (same idempotency key).
 * - `apply` — the base version matches and the session is still active; persist
 *   the client's new state and bump the version.
 * - `conflict` — the base version is stale, or the stored session is already
 *   completed (terminal). Either way the local change is retained for review
 *   rather than clobbering newer data, and completion can never be undone.
 */
export type FocusTransitionResolution =
  | "missing"
  | "replay"
  | "apply"
  | "conflict";

/** The fields the transition resolution compares on the stored session. */
export interface FocusTransitionState {
  version: number;
  idempotencyKey: string;
  status: FocusSessionStatus;
}

export function resolveFocusTransition(
  existing: FocusTransitionState | null,
  incoming: { baseVersion: number; idempotencyKey: string },
): FocusTransitionResolution {
  if (existing === null) {
    return "missing";
  }
  if (existing.idempotencyKey === incoming.idempotencyKey) {
    return "replay";
  }
  // Completion is terminal: a mutation arriving against a completed session is
  // stale by definition and must not resurrect or rewrite it.
  if (existing.status === "completed") {
    return "conflict";
  }
  return existing.version === incoming.baseVersion ? "apply" : "conflict";
}

/**
 * The calm acknowledgement shown when a Focus Session completes. Deliberately
 * free of scores, streaks, or "well done!" pressure — it simply confirms and
 * offers a way back. No other Task ever starts automatically.
 */
export const FOCUS_COMPLETED_MESSAGE =
  "Focus complete. Nicely done — take a breath.";
