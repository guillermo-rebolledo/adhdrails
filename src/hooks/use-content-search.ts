"use client";

import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import {
  searchPageSchema,
  type SearchPage,
  type SearchResult,
} from "@/domain/search/search";
import { apiRequest } from "@/lib/api-client";
import { useOptionalOffline } from "@/offline/provider";
import { searchLocalContent } from "@/offline/search";

export type SearchSource = "online" | "offline";

const SEARCH_MAX_PAGES = 5;

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);

  return debounced;
}

async function fetchSearchPage(query: string, cursor: string | null) {
  const response = await apiRequest<unknown>("/api/v1/search", {
    method: "POST",
    body: JSON.stringify({ query, cursor: cursor ?? undefined }),
  });
  if (!response.ok || !response.body) throw new Error("search_failed");
  return searchPageSchema.parse(response.body);
}

/**
 * TanStack Query owns cursor-paginated online views. Dexie remains the durable
 * fallback owner when the browser is offline or the server cannot be reached.
 */
export function useContentSearch(query: string, debounceMs = 200) {
  const offline = useOptionalOffline();
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, debounceMs);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [localItems, setLocalItems] = useState<SearchResult[]>([]);
  const [localCursor, setLocalCursor] = useState<string | null>(null);
  const [localLoading, setLocalLoading] = useState(false);

  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, []);

  const remote = useInfiniteQuery({
    queryKey: ["search", debouncedQuery],
    enabled: online && debouncedQuery.length > 0,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchSearchPage(debouncedQuery, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    maxPages: SEARCH_MAX_PAGES,
    staleTime: 30_000,
  });

  const useLocal = !online || remote.isError;

  useEffect(() => {
    if (!useLocal || !offline?.db || !debouncedQuery) return;
    let current = true;
    void Promise.resolve()
      .then(() => {
        if (current) setLocalLoading(true);
        return searchLocalContent(offline.db, debouncedQuery);
      })
      .then((page) => {
        if (!current) return;
        setLocalItems(page.items);
        setLocalCursor(page.nextCursor);
      })
      .finally(() => {
        if (current) setLocalLoading(false);
      });
    return () => {
      current = false;
    };
  }, [debouncedQuery, offline?.db, useLocal]);

  const remoteItems = useMemo(
    () => remote.data?.pages.flatMap((page) => page.items) ?? [],
    [remote.data?.pages],
  );

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = remote;
  const loadMore = async () => {
    if (useLocal) {
      if (!offline?.db || !localCursor || localLoading) return;
      setLocalLoading(true);
      const page: SearchPage = await searchLocalContent(
        offline.db,
        debouncedQuery,
        localCursor,
      );
      setLocalItems((current) => [...current, ...page.items]);
      setLocalCursor(page.nextCursor);
      setLocalLoading(false);
      return;
    }
    if (hasNextPage && !isFetchingNextPage) {
      await fetchNextPage();
    }
  };

  const waitingForDebounce =
    normalizedQuery.length > 0 && normalizedQuery !== debouncedQuery;
  const items = waitingForDebounce
    ? []
    : normalizedQuery
      ? useLocal
        ? localItems
        : remoteItems
      : [];

  return {
    items,
    nextCursor: useLocal
      ? localCursor
      : remote.hasNextPage
        ? "remote-next-page"
        : null,
    source: (useLocal ? "offline" : "online") satisfies SearchSource,
    loading:
      waitingForDebounce ||
      (useLocal ? localLoading : remote.isLoading || remote.isFetchingNextPage),
    loadMore,
  };
}
