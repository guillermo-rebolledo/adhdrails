"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useSyncExternalStore,
} from "react";

import {
  ENERGY_SELECTION_TTL_MS,
  type EnergySelection,
  resolveCurrentEnergy,
} from "@/domain/task/current-energy";
import type { TaskEnergy } from "@/domain/task/task";

const ENERGY_PREFIX = "rails:energy:";

function storageKeyFor(accountId: string): string {
  return `${ENERGY_PREFIX}${accountId}`;
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseSelection(raw: string | null): EnergySelection | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as EnergySelection;
    if (
      parsed &&
      typeof parsed.setAt === "string" &&
      (parsed.energy === "low" ||
        parsed.energy === "medium" ||
        parsed.energy === "high")
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// Subscribing through the `storage` event keeps every reader (including a second
// tab) in agreement; a manual dispatch after a same-tab write reaches this same
// listener, so no separate channel is needed.
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export interface CurrentEnergy {
  /** The effective current Energy, or null when unset or expired. */
  energy: TaskEnergy | null;
  /** Selects an Energy, or clears it with `null` ("Not set"). */
  setEnergy: (energy: TaskEnergy | null) => void;
}

/**
 * The device-local "Energy right now" selection for an account. It persists to
 * `localStorage` so a refresh keeps the state, and resolves through the domain
 * expiry rule so a selection older than the TTL reads as unset — an old state
 * never silently shapes recommendations. Read through `useSyncExternalStore` so
 * the server and first client render agree (both start unset) before the stored
 * value is applied, avoiding a hydration mismatch.
 */
export function useCurrentEnergy(accountId: string): CurrentEnergy {
  const key = storageKeyFor(accountId);

  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );

  // The stored value does not change when a selection merely expires, so schedule
  // a re-render for the moment it does — otherwise an expired Energy could linger
  // on screen until the next interaction.
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const selection = parseSelection(raw);
    if (selection === null) {
      return;
    }
    const remaining =
      Date.parse(selection.setAt) + ENERGY_SELECTION_TTL_MS - Date.now();
    if (remaining <= 0) {
      return;
    }
    const timer = setTimeout(tick, remaining + 50);
    return () => clearTimeout(timer);
  }, [raw]);

  const setEnergy = useCallback(
    (next: TaskEnergy | null) => {
      try {
        if (next === null) {
          window.localStorage.removeItem(key);
        } else {
          const selection: EnergySelection = {
            energy: next,
            setAt: new Date().toISOString(),
          };
          window.localStorage.setItem(key, JSON.stringify(selection));
        }
        // Notify this tab's subscribers; other tabs get the native event.
        window.dispatchEvent(new StorageEvent("storage", { key }));
      } catch {
        // Best-effort (storage may be unavailable in private mode).
      }
    },
    [key],
  );

  const energy = resolveCurrentEnergy(
    parseSelection(raw),
    new Date().toISOString(),
  );

  return { energy, setEnergy };
}
