"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { Button, buttonVariants } from "@/components/ui/button";
import { classifyInboxItemAsThought } from "@/offline/commands";
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
  const { db, sync } = useOffline();
  const [message, setMessage] = useState("");
  const items = useLiveQuery(
    () =>
      db.inboxItems
        .orderBy("createdAt")
        .reverse()
        .filter((item) => !item.classifiedAt)
        .toArray(),
    [db],
  );

  if (items === undefined) {
    return null;
  }

  if (items.length === 0) {
    return (
      <>
        <p className="sr-only" role="status">
          {message}
        </p>
        <p className="text-muted-foreground">
          Your Inbox is calm. Captures will wait here without pressure.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="sr-only" role="status">
        {message}
      </p>
      <ul aria-label="Inbox items" className="flex flex-col gap-2">
        {items.map((item) => (
          <InboxRow
            item={item}
            key={item.id}
            onSave={async () => {
              await classifyInboxItemAsThought(db, item);
              setMessage("Saved as a Thought.");
              void sync();
            }}
          />
        ))}
      </ul>
    </>
  );
}

function InboxRow({
  item,
  onSave,
}: {
  item: LocalInboxItem;
  onSave: () => Promise<void>;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate">{item.title}</p>
        <span
          className="text-xs text-muted-foreground"
          data-sync-state={item.syncState}
        >
          {syncStateCopy[item.syncState]}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          className={buttonVariants({ size: "sm", variant: "ghost" })}
          href={`/tasks/new?title=${encodeURIComponent(item.title)}`}
        >
          Turn into task
        </Link>
        <Button onClick={() => void onSave()} size="sm" variant="outline">
          Save as Thought
        </Button>
      </div>
    </li>
  );
}
