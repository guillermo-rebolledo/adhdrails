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

import { getClientDatabase, type OutboxEntry, type RailsDatabase } from "./db";
import { createEventSend } from "./event-send";
import { createInboxSend } from "./inbox-send";
import { createThoughtSend } from "./outbox-send";
import { createTaskSend } from "./task-send";
import { createSyncEngine, type SendResult, type SyncEngine } from "./sync";
import { pullThoughts } from "./thought-pull";

/**
 * Routes an outbox entry to the delivery adapter for its entity. The sync
 * engine stays entity-agnostic; this map is the single place that knows which
 * transport each entity uses.
 */
function createSend(): (entry: OutboxEntry) => Promise<SendResult> {
  const senders = {
    inbox_item: createInboxSend(),
    task: createTaskSend(),
    thought: createThoughtSend(),
    event: createEventSend(),
  } as const;
  return (entry) => senders[entry.entity](entry);
}

interface OfflineContextValue {
  accountId: string;
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
 * The offline context when present, or `null` outside an {@link OfflineProvider}.
 * Lets progressively-enhanced chrome (such as the Inbox unseen badge) render
 * harmlessly in isolation — for example in a shell unit test — without pulling
 * in the whole offline stack.
 */
export function useOptionalOffline(): OfflineContextValue | null {
  return useContext(OfflineContext);
}

/**
 * Wires the client offline stack for the authenticated app: the Dexie replica,
 * the outbox sync engine (draining on mount and on reconnect), and a TanStack
 * Query client for the server-owned views that arrive in later slices. Dexie
 * remains the single owner of optimistic entity state.
 */
export function OfflineProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const [db] = useState(() => getClientDatabase(accountId));
  const engineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    const engine = createSyncEngine({
      db,
      send: createSend(),
      isOnline: () => navigator.onLine,
      afterSync: () => pullThoughts(db).catch(() => undefined),
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
      accountId,
      db,
      sync: () => engineRef.current?.sync() ?? Promise.resolve(),
    }),
    [accountId, db],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <OfflineContext.Provider value={value}>
        {children}
      </OfflineContext.Provider>
    </QueryClientProvider>
  );
}
