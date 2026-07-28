import {
  applyFocusAction,
  type FocusAction,
  type FocusSessionState,
  focusSessionStartRequestSchema,
  isFocusActionAllowed,
  toTransitionRequest,
} from "@/domain/focus/session";

import type { LocalFocusSession, OutboxEntry, RailsDatabase } from "./db";
import { nextMutationSequence } from "./mutation-sequence";

/**
 * The client-generated identity and idempotency for a focus mutation. Both are
 * optional so a caller (or a test) may pin them; otherwise they are generated.
 */
export interface FocusCommandOptions {
  id?: string;
  idempotencyKey?: string;
  outboxId?: string;
  now?: string;
}

/** The timing-bearing state the domain machine reads from a local session. */
export function focusStateOf(session: LocalFocusSession): FocusSessionState {
  return {
    status: session.status,
    accumulatedSeconds: session.accumulatedSeconds,
    lastResumedAt: session.lastResumedAt,
    completedAt: session.completedAt,
  };
}

export interface StartFocusInput {
  taskId: string;
}

/**
 * Starts the account's Focus Session. In one atomic Dexie transaction it writes
 * the optimistic running session and its create outbox entry, so the session is
 * acknowledged locally within the performance budget yet never without a durable
 * instruction to synchronize it. The client-generated id becomes the server id,
 * so the record never needs temporary-ID remapping. The account-wide single-
 * active invariant is enforced by the server on delivery; a competing session
 * started elsewhere comes back as a reviewable conflict.
 */
export async function startFocus(
  db: RailsDatabase,
  input: StartFocusInput,
  options: FocusCommandOptions = {},
): Promise<LocalFocusSession> {
  const id = options.id ?? crypto.randomUUID();
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const now = options.now ?? new Date().toISOString();

  const payload = focusSessionStartRequestSchema.parse({
    id,
    taskId: input.taskId,
    idempotencyKey,
  });

  const session: LocalFocusSession = {
    id,
    taskId: input.taskId,
    status: "running",
    accumulatedSeconds: 0,
    lastResumedAt: now,
    distractionCount: 0,
    startedAt: now,
    completedAt: null,
    version: 1,
    createdAt: now,
    syncState: "pending",
  };

  const entry: OutboxEntry = {
    id: options.outboxId ?? crypto.randomUUID(),
    entity: "focus_session",
    operation: "create",
    entityId: id,
    idempotencyKey,
    baseVersion: null,
    payload,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: now,
    sequence: nextMutationSequence(),
  };

  await db.transaction("rw", db.focusSessions, db.outbox, async () => {
    await db.focusSessions.add(session);
    await db.outbox.add(entry);
  });

  return session;
}

/**
 * Applies a transition (pause, resume, complete) to the local session and queues
 * its delivery. The client owns the count-up clock, so the outbox entry carries
 * the absolute resulting state; a run of offline transitions collapses into one
 * pending update (last write wins) that keeps the original base version and
 * idempotency key. An illegal transition for the current status is a no-op, so a
 * stale double-tap cannot corrupt the timer.
 */
export async function transitionFocus(
  db: RailsDatabase,
  id: string,
  action: FocusAction,
  options: FocusCommandOptions = {},
): Promise<LocalFocusSession | null> {
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const now = options.now ?? new Date().toISOString();
  let updated: LocalFocusSession | null = null;

  await db.transaction("rw", db.focusSessions, db.outbox, async () => {
    const local = await db.focusSessions.get(id);
    if (!local || !isFocusActionAllowed(local.status, action)) {
      updated = local ?? null;
      return;
    }

    const next = applyFocusAction(focusStateOf(local), action, now);
    updated = {
      ...local,
      status: next.status,
      accumulatedSeconds: next.accumulatedSeconds,
      lastResumedAt: next.lastResumedAt,
      completedAt: next.completedAt,
      syncState: "pending",
    };
    await db.focusSessions.put(updated);

    const [pending] = await db.outbox
      .filter(
        (entry) =>
          entry.entityId === id &&
          entry.operation === "update" &&
          entry.status === "pending",
      )
      .toArray();

    if (pending) {
      // Keep the first pending entry's base version and idempotency key; only
      // its resulting state is replaced with the latest.
      await db.outbox.update(pending.id, {
        payload: toTransitionRequest(
          next,
          pending.baseVersion ?? local.version,
          pending.idempotencyKey,
        ),
      });
      return;
    }

    const entry: OutboxEntry = {
      id: options.outboxId ?? crypto.randomUUID(),
      entity: "focus_session",
      operation: "update",
      entityId: id,
      idempotencyKey,
      baseVersion: local.version,
      payload: toTransitionRequest(next, local.version, idempotencyKey),
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: now,
      sequence: nextMutationSequence(),
    };
    await db.outbox.add(entry);
  });

  return updated;
}

export function pauseFocus(
  db: RailsDatabase,
  id: string,
  options: FocusCommandOptions = {},
): Promise<LocalFocusSession | null> {
  return transitionFocus(db, id, "pause", options);
}

export function resumeFocus(
  db: RailsDatabase,
  id: string,
  options: FocusCommandOptions = {},
): Promise<LocalFocusSession | null> {
  return transitionFocus(db, id, "resume", options);
}

export function completeFocus(
  db: RailsDatabase,
  id: string,
  options: FocusCommandOptions = {},
): Promise<LocalFocusSession | null> {
  return transitionFocus(db, id, "complete", options);
}
