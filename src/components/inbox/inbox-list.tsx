"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { buttonVariants } from "@/components/ui/button";
import type { LocalInboxItem, SyncState } from "@/offline/db";
import { useOffline } from "@/offline/provider";

const syncStateCopy: Record<SyncState, string> = {
  pending: "Pending sync",
  synced: "Saved",
  failed: "Sync failed — will retry",
  conflict: "Needs review",
};

/**
 * The Inbox reads optimistic state straight from the Dexie replica via
 * `useLiveQuery`, so a capture appears immediately whether the account is
 * online or offline. TanStack Query never takes ownership of these items. Each
 * item carries an accessible status so the pending, saved, and conflict states
 * are understandable to screen-reader users, not just visually.
 */
export function InboxList() {
  const { db } = useOffline();
  const items = useLiveQuery(
    () => db.inboxItems.orderBy("createdAt").reverse().toArray(),
    [db],
  );

  if (items === undefined) {
    return null;
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground">
        Your Inbox is calm. Captures will wait here without pressure.
      </p>
    );
  }

  return (
    <ul aria-label="Inbox items" className="flex flex-col gap-2">
      {items.map((item) => (
        <InboxRow item={item} key={item.id} />
      ))}
    </ul>
  );
}

function InboxRow({ item }: { item: LocalInboxItem }) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3 text-card-foreground">
      <span className="min-w-0 truncate">{item.title}</span>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          className={buttonVariants({ size: "sm", variant: "ghost" })}
          href={`/tasks/new?title=${encodeURIComponent(item.title)}`}
        >
          Turn into task
        </Link>
        <span
          className="text-xs text-muted-foreground"
          data-sync-state={item.syncState}
        >
          {syncStateCopy[item.syncState]}
        </span>
      </div>
    </li>
  );
}
