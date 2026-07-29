import type { QueryClient } from "@tanstack/react-query";

import { pullAreas } from "./area-pull";
import type { RailsDatabase } from "./db";
import { pullFocusSession } from "./focus-pull";
import { pullThoughts } from "./thought-pull";

/**
 * The single post-sync reconciliation boundary. Entity pulls refresh Dexie,
 * then Task view membership is invalidated so cursor pages reflect completed,
 * rescheduled, created, and deleted Tasks acknowledged by the server.
 */
export async function refreshServerViews(
  db: RailsDatabase,
  queryClient: QueryClient,
): Promise<void> {
  await Promise.allSettled([
    pullThoughts(db),
    pullAreas(db),
    pullFocusSession(db),
  ]);
  await queryClient.invalidateQueries({ queryKey: ["tasks"] });
}
