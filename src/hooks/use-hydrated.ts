"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/** False during SSR/hydration, true once client events can be handled safely. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
