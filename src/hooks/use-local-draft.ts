"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const DRAFT_PREFIX = "rails:draft:";

// The persisted draft is client-only data. Reading it through
// useSyncExternalStore keeps the server and first client render in agreement
// (both start from the seed) while restoring the saved value once mounted.
const noopSubscribe = () => () => {};

export interface LocalDraft {
  value: string;
  setValue: (next: string) => void;
  clear: () => void;
}

function storageKeyFor(key: string): string {
  return `${DRAFT_PREFIX}${key}`;
}

/**
 * A device-local, debounced text draft that survives navigation and
 * interruption. Keystrokes update React state immediately, so typing never
 * waits on storage; the value is written to `localStorage` only after a short
 * idle delay. A supplied seed (e.g. a title carried from the Inbox) always
 * wins over any saved draft.
 */
export function useLocalDraft(
  key: string,
  seed = "",
  delayMs = 400,
): LocalDraft {
  const storageKey = storageKeyFor(key);

  const persistedInitial = useSyncExternalStore(
    noopSubscribe,
    () => {
      if (seed !== "") {
        return seed;
      }
      try {
        return window.localStorage.getItem(storageKey) ?? "";
      } catch {
        return "";
      }
    },
    () => seed,
  );

  // `null` means "untouched" — fall back to the restored/seed value until the
  // user types, so restoring a draft never needs a setState in an effect.
  const [edited, setEdited] = useState<string | null>(null);
  const value = edited ?? persistedInitial;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist edits after an idle delay. Writing to storage is the intended kind
  // of effect (syncing an external system); it never calls setState.
  useEffect(() => {
    if (edited === null) {
      return;
    }
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, value);
      } catch {
        // Best-effort persistence (storage may be unavailable in private mode).
      }
    }, delayMs);

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [storageKey, value, edited, delayMs]);

  const setValue = useCallback((next: string) => setEdited(next), []);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Best-effort.
    }
    setEdited("");
  }, [storageKey]);

  return { value, setValue, clear };
}
