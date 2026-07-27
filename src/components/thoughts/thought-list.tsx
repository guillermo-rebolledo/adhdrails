"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { LightbulbIcon } from "lucide-react";
import Link from "next/link";

import { Input } from "@/components/ui/input";
import { useOffline } from "@/offline/provider";

export function ThoughtList() {
  const { db } = useOffline();
  const [query, setQuery] = useState("");
  const thoughts = useLiveQuery(
    () =>
      db.thoughts
        .orderBy("updatedAt")
        .reverse()
        .filter((thought) => thought.deletedAt === null)
        .toArray(),
    [db],
  );

  if (thoughts === undefined) return null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = thoughts.filter(
    (thought) =>
      normalizedQuery === "" ||
      thought.title.toLocaleLowerCase().includes(normalizedQuery) ||
      thought.body.toLocaleLowerCase().includes(normalizedQuery),
  );

  return (
    <div className="flex flex-col gap-4">
      <Input
        aria-label="Search Thoughts"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search Thoughts"
        type="search"
        value={query}
      />
      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          {thoughts.length === 0
            ? "No Thoughts yet. Save a reference when something is worth keeping."
            : "No Thoughts match that search."}
        </p>
      ) : (
        <ul aria-label="Thoughts" className="grid gap-3 sm:grid-cols-2">
          {visible.map((thought) => (
            <li key={thought.id}>
              <Link
                className="group flex h-full flex-col gap-3 rounded-xl border bg-card p-5 text-card-foreground transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                href={`/thoughts/${thought.id}`}
              >
                <LightbulbIcon
                  aria-hidden="true"
                  className="size-5 text-amber-600 dark:text-amber-400"
                />
                <div>
                  <h2 className="font-medium">{thought.title}</h2>
                  {thought.body ? (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {thought.body}
                    </p>
                  ) : null}
                </div>
                <span className="mt-auto text-xs text-muted-foreground">
                  Non-actionable reference
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
