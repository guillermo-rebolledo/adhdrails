import { Temporal } from "temporal-polyfill";

import type { TaskEnergy } from "./task";

/**
 * The user's "Energy right now" is a temporary, low-commitment signal: it
 * reorders flexible work to match how someone feels, then quietly expires so an
 * old state never silently shapes later recommendations. These pure helpers own
 * the expiry rule; the client hook owns where the selection is stored. No React,
 * Next.js, Drizzle, or network dependencies live here.
 */

/** How long an Energy selection stays active before it expires (~3 hours). */
export const ENERGY_SELECTION_TTL_MS = 3 * 60 * 60 * 1000;

/** A temporary Energy selection: the chosen Energy and when it was set. */
export interface EnergySelection {
  energy: TaskEnergy;
  /** The instant the selection was made, as an ISO-8601 string. */
  setAt: string;
}

function epochMs(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

/**
 * Whether a selection is still active at `now`: within the TTL window and not
 * from the future (a clock skew or stale write never counts as active).
 */
export function isEnergySelectionActive(
  selection: EnergySelection,
  now: string,
): boolean {
  const elapsed = epochMs(now) - epochMs(selection.setAt);
  return elapsed >= 0 && elapsed < ENERGY_SELECTION_TTL_MS;
}

/**
 * The effective current Energy at `now`: the selected Energy while it is still
 * active, or null once it has expired or was never set. A null result means "no
 * Energy constraint" for the recommender.
 */
export function resolveCurrentEnergy(
  selection: EnergySelection | null,
  now: string,
): TaskEnergy | null {
  if (selection === null) {
    return null;
  }
  return isEnergySelectionActive(selection, now) ? selection.energy : null;
}
