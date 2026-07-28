"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  searchPageSchema,
  type SearchPage,
  type SearchResult,
} from "@/domain/search/search";
import { apiRequest } from "@/lib/api-client";
import { searchLocalContent } from "@/offline/search";

import { useOptionalOffline } from "../offline/provider";

export type SearchSource = "online" | "offline";

export function useContentSearch(query: string, debounceMs = 200) {
  const offline = useOptionalOffline();
  const db = offline?.db;
  const [items, setItems] = useState<SearchResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [source, setSource] = useState<SearchSource>("online");
  const [loading, setLoading] = useState(false);
  const [resolvedQuery, setResolvedQuery] = useState("");
  const requestSequence = useRef(0);

  const run = useCallback(
    async (
      searchedQuery: string,
      cursor: string | null,
      append: boolean,
      signal?: AbortSignal,
    ) => {
      const sequence = ++requestSequence.current;
      setLoading(true);
      let page: SearchPage;

      try {
        if (!navigator.onLine) throw new Error("offline");
        const response = await apiRequest<unknown>("/api/v1/search", {
          method: "POST",
          body: JSON.stringify({
            query: searchedQuery,
            cursor: cursor ?? undefined,
          }),
          signal,
        });
        if (!response.ok || !response.body) throw new Error("search_failed");
        page = searchPageSchema.parse(response.body);
        if (sequence !== requestSequence.current) return;
        setSource("online");
      } catch {
        if (signal?.aborted) return;
        page = db
          ? await searchLocalContent(db, searchedQuery, cursor)
          : { items: [], nextCursor: null };
        if (sequence !== requestSequence.current) return;
        setSource("offline");
      }

      setItems((current) =>
        append ? [...current, ...page.items] : page.items,
      );
      setNextCursor(page.nextCursor);
      setResolvedQuery(searchedQuery);
      setLoading(false);
    },
    [db],
  );

  useEffect(() => {
    const searchedQuery = query.trim();
    if (!searchedQuery) {
      requestSequence.current += 1;
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void run(searchedQuery, null, false, controller.signal);
    }, debounceMs);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [debounceMs, query, run]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loading) return Promise.resolve();
    return run(query.trim(), nextCursor, true);
  }, [loading, nextCursor, query, run]);

  const normalizedQuery = query.trim();
  const showsResolvedQuery =
    normalizedQuery.length > 0 && normalizedQuery === resolvedQuery;

  return {
    items: showsResolvedQuery ? items : [],
    nextCursor: showsResolvedQuery ? nextCursor : null,
    source:
      normalizedQuery.length === 0
        ? navigator.onLine
          ? "online"
          : "offline"
        : source,
    loading: normalizedQuery.length > 0 && (loading || !showsResolvedQuery),
    loadMore,
  };
}
