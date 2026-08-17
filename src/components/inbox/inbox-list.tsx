"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { CaptureChips } from "@/components/inbox/capture-chips";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { useClock } from "@/components/account/time-zone-provider";

const syncStateCopy: Record<SyncState, string> = {
  pending: "Pending sync",
  synced: "Saved",
  failed: "Sync failed — will retry",
  conflict: "Needs review",
};

/** How long an app-owned deletion can be undone before it finalizes. */
const UNDO_WINDOW_MS = 10_000;
/**
 * How long a retired row is held on screen to collapse out of the list. Matches
 * `--motion-calm` in `globals.css`; the row unmounts once it finishes, so a
 * longer value would leave an invisible row holding space in the list and a
 * shorter one would cut the collapse off partway.
 */
const ROW_EXIT_MS = 260;

/** A row mid-collapse, with the slot it held in the rendered list. */
interface ExitingRow {
  item: LocalInboxItem;
  index: number;
}

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
  undoWindowMs = UNDO_WINDOW_MS,
  highlightedItemId,
  ...overrides
}: {
  timeZone?: string;
  locale?: string;
  /** The delete Undo window. Overridable only to keep tests fast. */
  undoWindowMs?: number;
  /** Search deep-link target to focus and distinguish on arrival. */
  highlightedItemId?: string;
} = {}) {
  const { timeZone, locale } = useClock(overrides);
  const { db, sync } = useOffline();
  const [message, setMessage] = useState("");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeleteId = useRef<string | null>(null);

  /*
   * Rows on their way out.
   *
   * Five different actions retire an Inbox row — delete, skip, and the three
   * classifications — and every one of them made it disappear instantly while
   * the list snapped shut underneath. Processing an Inbox is a repetitive act,
   * so that snap happens over and over; a row that collapses instead lets the
   * user see which one they just dealt with and keeps their place in the list.
   *
   * Skipped rows are still in the live query and merely filtered out, while
   * deleted and classified ones are genuinely gone from it. Holding a snapshot
   * covers both without each caller needing to know which kind it is.
   */
  const [exiting, setExiting] = useState<ExitingRow[]>([]);
  const exitTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  function beginExit(item: LocalInboxItem) {
    // Capture the row's position now, while it is still rendered. Skip runs
    // this before marking the row skipped and the other four run it before the
    // write lands, so in every case the row is still in the list here.
    const index = (items ?? [])
      .filter((row) => !skipped.has(row.id))
      .findIndex((row) => row.id === item.id);
    setExiting((current) =>
      current.some((row) => row.item.id === item.id)
        ? current
        : [...current, { item, index: index === -1 ? 0 : index }],
    );
    const existing = exitTimers.current.get(item.id);
    if (existing) {
      clearTimeout(existing);
    }
    exitTimers.current.set(
      item.id,
      setTimeout(() => {
        exitTimers.current.delete(item.id);
        setExiting((current) =>
          current.filter((row) => row.item.id !== item.id),
        );
      }, ROW_EXIT_MS),
    );
  }

  /** Drops a row out of the exit set immediately — used when Undo restores it. */
  function cancelExit(id: string) {
    const timer = exitTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      exitTimers.current.delete(id);
    }
    setExiting((current) => current.filter((row) => row.item.id !== id));
  }

  const items = useLiveQuery(
    () =>
      db.inboxItems
        .orderBy("createdAt")
        .reverse()
        .filter((item) => !item.classifiedAt && !item.deletedAt)
        .toArray(),
    [db],
  );

  useEffect(() => {
    if (!items || !highlightedItemId) return;
    document.getElementById(`inbox-item-${highlightedItemId}`)?.focus();
  }, [highlightedItemId, items]);

  // Opening the Inbox marks everything currently waiting as seen. Newly captured
  // items arrive unseen and restore the badge on their own.
  useEffect(() => {
    void markInboxItemsSeen(db)
      .then(() => sync())
      .catch(() => undefined);
  }, [db, sync]);

  // Finalize any still-pending deletion on unmount so it is never silently lost.
  useEffect(() => {
    // Captured on mount rather than read in the cleanup: the cleanup runs after
    // the component is gone, and the exit timers it has to clear are the ones
    // that belonged to this instance.
    const timers = exitTimers.current;
    return () => {
      if (deleteTimer.current) {
        clearTimeout(deleteTimer.current);
      }
      if (pendingDeleteId.current) {
        void finalizeInboxItemDeletion(db, pendingDeleteId.current);
      }
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
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
    beginExit(item);
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
    cancelExit(pendingDelete.id);
    await restoreInboxItem(db, pendingDelete.id);
    setPendingDelete(null);
  }

  function onSkip(item: LocalInboxItem) {
    beginExit(item);
    setSkipped((previous) => new Set(previous).add(item.id));
    setMessage("Skipped for now. It stays in your Inbox.");
  }

  if (items === undefined) {
    return null;
  }

  /*
   * The rows to render: the query's own order, with anything mid-collapse
   * spliced back into the slot it held.
   *
   * A skipped row is still in the query and merely filtered out, so it keeps
   * its place for free. Deleted and classified rows are genuinely gone and have
   * to be put back — by remembered index rather than by re-deriving a sort,
   * because reproducing an ordering the query owns means two places have to
   * agree forever, and the copy here is the one that would silently drift.
   *
   * Ascending index order matters: each remembered index refers to a list that
   * already contains the rows inserted before it. The highlight sort still runs
   * last, unchanged, because a deep-linked row belongs on top regardless.
   */
  const exitingIds = new Set(exiting.map((row) => row.item.id));
  const liveIds = new Set(items.map((item) => item.id));
  const visible = items.filter(
    (item) => !skipped.has(item.id) || exitingIds.has(item.id),
  );
  for (const row of exiting
    .filter(({ item }) => !liveIds.has(item.id))
    .sort((left, right) => left.index - right.index)) {
    visible.splice(Math.min(row.index, visible.length), 0, row.item);
  }
  visible.sort((left, right) =>
    left.id === highlightedItemId ? -1 : right.id === highlightedItemId ? 1 : 0,
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="sr-only" role="status">
        {message}
      </p>

      <div aria-live="polite">
        {pendingDelete ? (
          <div
            className="flex animate-in items-center justify-between gap-4 rounded-lg border bg-muted/40 p-3 text-sm duration-(--motion-quick) ease-enter fade-in-0"
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
        /*
         * Row spacing lives inside each row rather than as a list `gap`: a flex
         * gap is drawn between children whatever their height, so a row
         * collapsing to nothing would still leave its gap and the list would
         * close in two visible steps.
         */
        <ul aria-label="Inbox items" className="flex flex-col">
          {visible.map((item) => {
            const isExiting = exitingIds.has(item.id);
            return (
              <li
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-(--motion-calm) ease-exit motion-reduce:transition-none",
                  isExiting ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
                )}
                key={item.id}
                // A row mid-collapse has already been dealt with; its controls
                // must not be clickable or focusable on the way out.
                inert={isExiting}
              >
                <div className="overflow-hidden pb-2">
                  <InboxRow
                    item={item}
                    highlighted={item.id === highlightedItemId}
                    locale={locale}
                    timeZone={timeZone}
                    onDelete={() => onDelete(item)}
                    onSkip={() => onSkip(item)}
                    onClassifyThought={async (title) => {
                      beginExit(item);
                      await classifyInboxItemAsThought(db, item, { title });
                      setMessage("Saved as a Thought.");
                      void sync();
                    }}
                    onClassifyTask={async (title) => {
                      beginExit(item);
                      await classifyInboxItemAsTask(db, item, { title });
                      setMessage("Turned into a Task.");
                      void sync();
                    }}
                    onClassifyEvent={async (input) => {
                      beginExit(item);
                      await classifyInboxItemAsEvent(db, item, input);
                      setMessage("Added to your calendar.");
                      void sync();
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function InboxRow({
  item,
  highlighted,
  timeZone,
  locale,
  onClassifyThought,
  onClassifyTask,
  onClassifyEvent,
  onSkip,
  onDelete,
}: {
  item: LocalInboxItem;
  highlighted: boolean;
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

  // The list item itself is the collapsing wrapper the caller renders, so this
  // is the card inside it rather than the `<li>` — nesting one list item in
  // another is invalid markup and confuses the list's item count in assistive
  // tech. The deep-link `id` and its focus target stay here, on the card that
  // actually carries the highlight.
  return (
    <div
      aria-current={highlighted ? "true" : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground",
        highlighted && "border-ring ring-2 ring-ring/30",
      )}
      id={`inbox-item-${item.id}`}
      tabIndex={highlighted ? -1 : undefined}
    >
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
    </div>
  );
}
