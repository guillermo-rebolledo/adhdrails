"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckSquareIcon,
  InboxIcon,
  LightbulbIcon,
  SearchIcon,
} from "lucide-react";

import { useAnalytics } from "@/components/analytics/analytics-provider";
import { Button } from "@/components/ui/button";
import { type SearchResultType } from "@/domain/search/search";
import { useContentSearch } from "@/hooks/use-content-search";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

const typePresentation = {
  task: { label: "Task", icon: CheckSquareIcon },
  thought: { label: "Thought", icon: LightbulbIcon },
  inbox_item: { label: "Inbox item", icon: InboxIcon },
} satisfies Record<
  SearchResultType,
  { label: string; icon: typeof SearchIcon }
>;

export function SearchView({ debounceMs = 200 }: { debounceMs?: number }) {
  const router = useRouter();
  const analytics = useAnalytics();
  const hydrated = useHydrated();
  const listId = useId();
  const optionId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const { items, nextCursor, source, loading, loadMore } = useContentSearch(
    query,
    debounceMs,
  );

  // Record one content-free analytics event per settled query — only whether it
  // returned any results, never the query text itself. The ref dedupes so the
  // event fires once per distinct search rather than on every re-render.
  const trackedQuery = useRef<string | null>(null);
  const normalizedQuery = query.trim();
  useEffect(() => {
    if (loading || normalizedQuery.length === 0) {
      return;
    }
    if (trackedQuery.current === normalizedQuery) {
      return;
    }
    trackedQuery.current = normalizedQuery;
    analytics.track({
      name: "search_performed",
      results: items.length > 0 ? "some" : "none",
    });
  }, [analytics, loading, normalizedQuery, items.length]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        items.length === 0 ? -1 : (index + 1) % items.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        items.length === 0 ? -1 : (index - 1 + items.length) % items.length,
      );
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const result = items[activeIndex];
      if (result) router.push(result.href);
    }
  }

  const searched = query.trim().length > 0;
  const status = loading
    ? "Searching…"
    : searched
      ? `${items.length} ${items.length === 1 ? "result" : "results"} found${source === "offline" ? " offline" : ""}.`
      : "Type to search Tasks, Thoughts, and Inbox Items.";

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          aria-activedescendant={
            activeIndex >= 0 ? `${optionId}-${activeIndex}` : undefined
          }
          aria-controls={listId}
          aria-expanded={searched}
          aria-label="Search your Rails content"
          autoComplete="off"
          autoFocus
          className="h-11 w-full rounded-lg border bg-background pr-3 pl-10 text-base transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={!hydrated}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search Tasks, Thoughts, and Inbox Items"
          role="combobox"
          value={query}
        />
      </div>

      <p className="sr-only" role="status">
        {status}
      </p>

      {searched && source === "offline" ? (
        <p className="text-sm text-muted-foreground">Offline results</p>
      ) : null}

      <div aria-label="Search results" id={listId} role="listbox">
        {!loading && searched && items.length === 0 ? (
          <div className="rounded-xl border bg-card p-6 text-center">
            <p className="font-medium">No matches yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try fewer words or a different spelling.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((result, index) => {
              const presentation = typePresentation[result.type];
              const Icon = presentation.icon;
              return (
                <button
                  key={`${result.type}:${result.id}`}
                  aria-selected={index === activeIndex}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors outline-none",
                    index === activeIndex
                      ? "border-ring bg-muted/60"
                      : "hover:bg-muted/40",
                  )}
                  id={`${optionId}-${index}`}
                  onClick={() => router.push(result.href)}
                  onPointerMove={() => setActiveIndex(index)}
                  role="option"
                  type="button"
                >
                  <Icon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {result.title}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
                        {presentation.label}
                      </span>
                    </span>
                    {result.excerpt ? (
                      <span className="mt-1 block truncate text-sm text-muted-foreground">
                        {result.excerpt}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {nextCursor ? (
        <Button
          className="self-center"
          disabled={loading}
          onClick={() => void loadMore()}
          variant="outline"
        >
          {loading ? "Loading…" : "Load more results"}
        </Button>
      ) : null}
    </div>
  );
}
