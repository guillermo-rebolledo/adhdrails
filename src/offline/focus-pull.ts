import { z } from "zod";

import {
  type FocusSessionResponse,
  focusSessionResponseSchema,
} from "@/domain/focus/session";
import { apiRequest } from "@/lib/api-client";

import type { LocalFocusSession, RailsDatabase } from "./db";

const activeFocusResponseSchema = z.object({
  session: focusSessionResponseSchema.nullable(),
});

function toLocalFocusSession(session: FocusSessionResponse): LocalFocusSession {
  return {
    id: session.id,
    taskId: session.taskId,
    status: session.status,
    accumulatedSeconds: session.accumulatedSeconds,
    lastResumedAt: session.lastResumedAt,
    distractionCount: session.distractionCount,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    version: session.version,
    createdAt: session.createdAt,
    syncState: "synced",
  };
}

/**
 * Reconciles the account's server-authoritative active session into Dexie so a
 * reopened app or a second device converges on the single real timer. A pending
 * local mutation is never overwritten; a synced local session that is no longer
 * the account's active one (completed or superseded elsewhere) is deactivated so
 * the UI shows exactly one session, or none.
 */
export async function reconcileActiveFocusSession(
  db: RailsDatabase,
  active: FocusSessionResponse | null,
  now: string = new Date().toISOString(),
): Promise<void> {
  await db.transaction("rw", db.focusSessions, async () => {
    if (active) {
      const local = await db.focusSessions.get(active.id);
      if (
        !local ||
        (local.syncState === "synced" && active.version >= local.version)
      ) {
        await db.focusSessions.put(toLocalFocusSession(active));
      }
      // Any other local session that still looks active lost the account-wide
      // race; deactivate it so only the real session shows. This includes a
      // session left in `conflict` after a rejected start — the server already
      // told us the winner, so the loser must not linger as a second active row.
      // A still-pending local session is left alone: it has not been delivered.
      const others = await db.focusSessions
        .filter(
          (session) =>
            session.id !== active.id &&
            session.status !== "completed" &&
            session.syncState !== "pending",
        )
        .toArray();
      for (const other of others) {
        await db.focusSessions.put({
          ...other,
          status: "completed",
          completedAt: other.completedAt ?? now,
        });
      }
      return;
    }

    // No active session on the server: a session completed elsewhere. Mark any
    // synced local active session completed so the UI converges. Pending local
    // sessions are left alone — they have not been delivered yet.
    const stale = await db.focusSessions
      .filter(
        (session) =>
          session.status !== "completed" && session.syncState === "synced",
      )
      .toArray();
    for (const session of stale) {
      await db.focusSessions.put({
        ...session,
        status: "completed",
        completedAt: session.completedAt ?? now,
      });
    }
  });
}

/**
 * Fetches the account's active session and reconciles it into Dexie. A failed
 * request (offline) leaves the local replica untouched, so the timer keeps
 * running from local state.
 */
export async function pullFocusSession(db: RailsDatabase): Promise<void> {
  const response = await apiRequest<unknown>("/api/v1/focus-session");
  if (!response.ok || !response.body) {
    return;
  }
  const parsed = activeFocusResponseSchema.parse(response.body);
  await reconcileActiveFocusSession(db, parsed.session);
}
