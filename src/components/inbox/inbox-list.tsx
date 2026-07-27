"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { CaptureChips } from "@/components/inbox/capture-chips";
import { Button } from "@/components/ui/button";
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/domain/account/onboarding";
import { instantFromLocalParts } from "@/domain/calendar/agenda";
import { type ChipKind, parseCapture } from "@/domain/capture/parser";
import {
  calendarConsequenceFor,
  conversionDraft,
} from "@/domain/inbox/classify";
import {
  type ClassifyEventOptions,
  classifyInboxItemAsEvent,
  classifyInboxItemAsTask,
  classifyInboxItemAsThought,
  deleteInboxItemLocally,
  finalizeInboxItemDeletion,
  markInboxItemsSeen,
  restoreInboxItem,
} from "@/offline/commands";
import type { LocalInboxItem, SyncState } from "@/offline/db";
import { useOffline } from "@/offline/provider";

const syncStateCopy: Record<SyncState, string> = {
  pending: "Pending sync",
  synced: "Saved",
  failed: "Sync failed — will retry",
  conflict: "Needs review",
};

/** How long an app-owned deletion can be undone before it finalizes. */
const UNDO_WINDOW_MS = 10_000;

interface PendingDelete {
  id: string;
  title: string;
}

/**
 * The Inbox processing list. It reads optimistic state straight from the Dexie
 * replica via `useLiveQuery`, so captures appear immediately whether online or
 * off, and TanStack Query never takes ownership of these items. Opening the
 * Inbox marks its current items seen, clearing the numberless unseen badge.
 *
 * Each item can be processed at the user's own pace — there is no batch
 * requirement and no Inbox Zero pressure. Detected date, time, and duration are
 * re-parsed and prefilled as editable chips; from there an item can become a
 * Task, an Event (with its Calendar consequence explained first), or a Thought,
 * or be skipped for now, or deleted with a 10-second Undo. Every status is
 * announced accessibly, not shown visually alone.
 */
export function InboxList({
  timeZone = DEFAULT_TIMEZONE,
  locale = DEFAULT_LOCALE,
  undoWindowMs = UNDO_WINDOW_MS,
}: {
  timeZone?: string;
  locale?: string;
  /** The delete Undo window. Overridable only to keep tests fast. */
  undoWindowMs?: number;
} = {}) {
  const { db, sync } = useOffline();
  const [message, setMessage] = useState("");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeleteId = useRef<string | null>(null);

  const items = useLiveQuery(
    () =>
      db.inboxItems
        .orderBy("createdAt")
        .reverse()
        .filter((item) => !item.classifiedAt && !item.deletedAt)
        .toArray(),
    [db],
  );

  // Opening the Inbox marks everything currently waiting as seen. Newly captured
  // items arrive unseen and restore the badge on their own.
  useEffect(() => {
    void markInboxItemsSeen(db)
      .then(() => sync())
      .catch(() => undefined);
  }, [db, sync]);

  // Finalize any still-pending deletion on unmount so it is never silently lost.
  useEffect(() => {
    return () => {
      if (deleteTimer.current) {
        clearTimeout(deleteTimer.current);
      }
      if (pendingDeleteId.current) {
        void finalizeInboxItemDeletion(db, pendingDeleteId.current);
      }
    };
  }, [db]);

  async function finalizeNow(id: string) {
    if (deleteTimer.current) {
      clearTimeout(deleteTimer.current);
      deleteTimer.current = null;
    }
    pendingDeleteId.current = null;
    await finalizeInboxItemDeletion(db, id);
    void sync();
    setPendingDelete((current) => (current?.id === id ? null : current));
  }

  async function onDelete(item: LocalInboxItem) {
    if (pendingDeleteId.current && pendingDeleteId.current !== item.id) {
      await finalizeNow(pendingDeleteId.current);
    }
    await deleteInboxItemLocally(db, item.id);
    pendingDeleteId.current = item.id;
    setPendingDelete({ id: item.id, title: item.title });
    deleteTimer.current = setTimeout(() => {
      void finalizeNow(item.id);
    }, undoWindowMs);
  }

  async function onUndoDelete() {
    if (!pendingDelete) {
      return;
    }
    if (deleteTimer.current) {
      clearTimeout(deleteTimer.current);
      deleteTimer.current = null;
    }
    pendingDeleteId.current = null;
    await restoreInboxItem(db, pendingDelete.id);
    setPendingDelete(null);
  }

  function onSkip(id: string) {
    setSkipped((previous) => new Set(previous).add(id));
    setMessage("Skipped for now. It stays in your Inbox.");
  }

  if (items === undefined) {
    return null;
  }

  const visible = items.filter((item) => !skipped.has(item.id));

  return (
    <div className="flex flex-col gap-3">
      <p className="sr-only" role="status">
        {message}
      </p>

      <div aria-live="polite">
        {pendingDelete ? (
          <div
            className="flex items-center justify-between gap-4 rounded-lg border bg-muted/40 p-3 text-sm"
            role="status"
          >
            <span>Inbox item deleted.</span>
            <Button onClick={onUndoDelete} size="sm" variant="ghost">
              Undo
            </Button>
          </div>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground">
          Your Inbox is calm. Captures will wait here without pressure.
        </p>
      ) : (
        <ul aria-label="Inbox items" className="flex flex-col gap-2">
          {visible.map((item) => (
            <InboxRow
              item={item}
              key={item.id}
              locale={locale}
              timeZone={timeZone}
              onDelete={() => onDelete(item)}
              onSkip={() => onSkip(item.id)}
              onClassifyThought={async (title) => {
                await classifyInboxItemAsThought(db, item, { title });
                setMessage("Saved as a Thought.");
                void sync();
              }}
              onClassifyTask={async (title) => {
                await classifyInboxItemAsTask(db, item, { title });
                setMessage("Turned into a Task.");
                void sync();
              }}
              onClassifyEvent={async (input) => {
                await classifyInboxItemAsEvent(db, item, input);
                setMessage("Added to your calendar.");
                void sync();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function InboxRow({
  item,
  timeZone,
  locale,
  onClassifyThought,
  onClassifyTask,
  onClassifyEvent,
  onSkip,
  onDelete,
}: {
  item: LocalInboxItem;
  timeZone: string;
  locale: string;
  onClassifyThought: (title: string) => Promise<void>;
  onClassifyTask: (title: string) => Promise<void>;
  onClassifyEvent: (input: ClassifyEventOptions) => Promise<void>;
  onSkip: () => void;
  onDelete: () => void;
}) {
  const [removed, setRemoved] = useState<Set<ChipKind>>(new Set());
  const [confirmingEvent, setConfirmingEvent] = useState(false);

  // Re-parse the captured title so detected schedule details are prefilled
  // during processing. The reference instant is captured once per row so a
  // relative date ("tomorrow") resolves against roughly the current moment.
  const [reference] = useState(() => new Date().toISOString());
  const parsed = useMemo(
    () => parseCapture(item.title, { reference, timeZone, locale }),
    [item.title, reference, timeZone, locale],
  );

  const visibleChips = parsed.chips.filter((chip) => !removed.has(chip.kind));
  const draft = conversionDraft(parsed.cleanedTitle, item.title, {
    date: removed.has("date") ? null : parsed.schedule.date,
    time: removed.has("time") ? null : parsed.schedule.time,
    durationMinutes: removed.has("duration")
      ? null
      : parsed.schedule.durationMinutes,
  });
  const canConfirmEvent = draft.date !== null && draft.time !== null;

  function removeChip(kind: ChipKind) {
    setRemoved((previous) => new Set(previous).add(kind));
    setConfirmingEvent(false);
  }

  async function confirmEvent() {
    if (!draft.date || !draft.time) {
      return;
    }
    await onClassifyEvent({
      title: draft.title,
      startAt: instantFromLocalParts(draft.date, draft.time, timeZone),
      timeZone,
      durationMinutes: draft.durationMinutes,
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground">
      <div className="min-w-0">
        <p className="truncate">{item.title}</p>
        <span
          className="text-xs text-muted-foreground"
          data-sync-state={item.syncState}
        >
          {syncStateCopy[item.syncState]}
        </span>
      </div>

      {visibleChips.length > 0 ? (
        <CaptureChips chips={visibleChips} onRemove={removeChip} />
      ) : null}

      {confirmingEvent ? (
        <div
          className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm"
          role="group"
          aria-label="Confirm calendar event"
        >
          <p>{calendarConsequenceFor("event", draft.durationMinutes)}</p>
          <div className="flex gap-2">
            <Button onClick={() => void confirmEvent()} size="sm">
              Add to calendar
            </Button>
            <Button
              onClick={() => setConfirmingEvent(false)}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void onClassifyTask(draft.title)}
            size="sm"
            variant="outline"
          >
            Turn into task
          </Button>
          {canConfirmEvent ? (
            <Button
              onClick={() => setConfirmingEvent(true)}
              size="sm"
              variant="outline"
            >
              Make an event
            </Button>
          ) : null}
          <Button
            onClick={() => void onClassifyThought(draft.title)}
            size="sm"
            variant="outline"
          >
            Save as Thought
          </Button>
          <Button onClick={onSkip} size="sm" variant="ghost">
            Skip
          </Button>
          <Button
            aria-label={`Delete ${item.title}`}
            onClick={onDelete}
            size="sm"
            variant="ghost"
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}
