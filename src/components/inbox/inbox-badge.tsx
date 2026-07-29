"use client";

import { useLiveQuery } from "dexie-react-hooks";

import { useOptionalOffline } from "@/offline/provider";

/**
 * The numberless red Inbox indicator. It informs without creating pressure: a
 * count is deliberately never shown, so the Inbox never becomes a number to
 * drive to zero. The unseen state is read straight from the Dexie replica, so it
 * reflects captures made online or offline. A visually hidden text equivalent in
 * a polite live region makes the state available to screen readers rather than
 * colour alone — announced without a competing `status` landmark.
 *
 * Rendered inside the Inbox navigation link, it appears only while unseen,
 * unclassified, undeleted captures exist and clears as soon as the Inbox is
 * opened.
 */
export function InboxBadge() {
  const offline = useOptionalOffline();
  const db = offline?.db;

  const hasUnseen = useLiveQuery(
    async () => {
      if (!db) {
        return false;
      }
      const count = await db.inboxItems
        .filter((item) => !item.seen && !item.classifiedAt && !item.deletedAt)
        .count();
      return count > 0;
    },
    [db],
    false,
  );

  if (!hasUnseen) {
    return null;
  }

  return (
    <span
      aria-live="polite"
      className="inline-flex size-2 shrink-0 rounded-full bg-destructive"
      data-testid="inbox-unseen-badge"
    >
      <span className="sr-only">New inbox items</span>
    </span>
  );
}
