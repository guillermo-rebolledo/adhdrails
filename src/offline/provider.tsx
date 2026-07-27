"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { getClientDatabase, type RailsDatabase } from "./db";
import { createInboxSend } from "./inbox-send";
import { createSyncEngine, type SyncEngine } from "./sync";

interface OfflineContextValue {
  db: RailsDatabase;
  /** Ask the sync engine to drain the outbox now (e.g. right after a capture). */
  sync: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function useOffline(): OfflineContextValue {
  const value = useContext(OfflineContext);
  if (!value) {
    throw new Error("useOffline must be used within an OfflineProvider.");
  }
  return value;
}

/**
 * Wires the client offline stack for the authenticated app: the Dexie replica,
 * the outbox sync engine (draining on mount and on reconnect), and a TanStack
 * Query client for the server-owned views that arrive in later slices. Dexie
 * remains the single owner of optimistic entity state.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [db] = useState(getClientDatabase);
  const engineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    const engine = createSyncEngine({
      db,
      send: createInboxSend(),
      isOnline: () => navigator.onLine,
    });
    engineRef.current = engine;
    engine.start();

    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [db]);

  const value = useMemo<OfflineContextValue>(
    () => ({
      db,
      sync: () => engineRef.current?.sync() ?? Promise.resolve(),
    }),
    [db],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <OfflineContext.Provider value={value}>
        {children}
      </OfflineContext.Provider>
    </QueryClientProvider>
  );
}
