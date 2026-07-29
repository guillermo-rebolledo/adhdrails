import { z } from "zod";

/**
 * Pure rules for the durable maintenance that keeps the Google Calendar mirror
 * resilient (MEM-43). Push watches expire, notifications go missing, and mirror
 * rows drift outside the window Rails renders — so periodic scheduled work renews
 * watches, reconciles calendars that have gone quiet, trims stale mirror rows, and
 * purges the operational outbox records those jobs leave behind. This module owns
 * only the timing decisions those sweeps make; it has no React, Next.js, Drizzle,
 * or network dependencies. The server layer runs the reads, writes, and Google
 * I/O, and the Inngest layer schedules it.
 *
 * @see ./notification.ts for the complementary per-watch renewal-lead rule.
 */

/**
 * How long a calendar may go without a successful sync before periodic
 * reconciliation resyncs it as a backstop. A healthy calendar is resynced on
 * every webhook, so it never reaches this age; only a calendar whose watch
 * expired or whose notifications were dropped goes quiet long enough to qualify,
 * which is exactly when reconciliation must step in.
 */
export const RECONCILIATION_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * The instant a calendar must have synced at or after to be considered current:
 * `now` minus {@link RECONCILIATION_STALE_MS}. A calendar last synced before this
 * cutoff — or never synced — is due for reconciliation.
 */
export function reconciliationCutoff(
  now: Date,
  staleMs: number = RECONCILIATION_STALE_MS,
): Date {
  return new Date(now.getTime() - staleMs);
}

/**
 * Whether a calendar is due for reconciliation now: it has never synced, or its
 * last successful sync is at least {@link RECONCILIATION_STALE_MS} in the past.
 */
export function reconciliationIsDue(
  lastSyncedAt: Date | null,
  now: Date,
  staleMs: number = RECONCILIATION_STALE_MS,
): boolean {
  if (!lastSyncedAt) {
    return true;
  }
  return lastSyncedAt.getTime() <= reconciliationCutoff(now, staleMs).getTime();
}

/**
 * How long a resolved maintenance-outbox row (a `completed`, `failed`, or
 * `skipped` sync or export job) is retained before the cleanup sweep purges it.
 * These rows are operational records — useful for diagnosing a recent failure —
 * so they are kept for a bounded window rather than indefinitely, then purged so
 * operational visibility never becomes unbounded growth.
 */
export const MAINTENANCE_JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The cutoff a resolved maintenance-outbox row must have been last updated before
 * to be purged: `now` minus {@link MAINTENANCE_JOB_RETENTION_MS}.
 */
export function maintenanceJobRetentionCutoff(
  now: Date,
  retentionMs: number = MAINTENANCE_JOB_RETENTION_MS,
): Date {
  return new Date(now.getTime() - retentionMs);
}

/**
 * The request contract for on-demand range expansion (MEM-43): the instant the
 * client wants the mirror to reach. Accepts any parseable instant so the client
 * can pass the far edge of the Later view it is scrolling toward.
 */
export const expandRangeRequestSchema = z.object({
  through: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "A valid `through` instant is required.",
    }),
});

export type ExpandRangeRequest = z.infer<typeof expandRangeRequestSchema>;
