"use client";

import { type FormEvent, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { CaptureChips } from "@/components/inbox/capture-chips";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/domain/account/onboarding";
import { instantFromLocalParts } from "@/domain/calendar/agenda";
import { type ChipKind, parseCapture } from "@/domain/capture/parser";
import { INBOX_TITLE_MAX_LENGTH } from "@/domain/inbox/capture";
import { useHydrated } from "@/hooks/use-hydrated";
import { captureInboxItem } from "@/offline/commands";
import { createEvent } from "@/offline/event-commands";
import { useOffline } from "@/offline/provider";

/** Duration a confirmed timed capture defaults to when none was detected. */
const DEFAULT_DURATION_MINUTES = 30;

interface CaptureStatus {
  text: string;
  /** The raw capture text offered as a prefill when the parser found nothing. */
  addDetailsTitle: string | null;
}

/**
 * Quick Capture on Today. As the user types, a conservative parser proposes any
 * date, time, or duration it recognizes and shows them as editable chips before
 * anything is classified. Capture always stores the raw text safely in the
 * Inbox — so uncertain input is never lost and no parser decision is
 * irreversible. When a specific time is detected the user may instead confirm it
 * as an Event: confirming is the classification step, so it creates a local
 * Event straight away, carrying the detected date, time, and duration through
 * the established offline mutation path. A capture is acknowledged locally well
 * within the 100ms budget; delivery happens in the background.
 */
export function QuickCapture({
  timeZone = DEFAULT_TIMEZONE,
  locale = DEFAULT_LOCALE,
}: {
  timeZone?: string;
  locale?: string;
}) {
  const { db, sync } = useOffline();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [removed, setRemoved] = useState<Set<ChipKind>>(new Set());
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const hydrated = useHydrated();

  // Parsing is pure and cheap, so it runs on each change once hydrated. The
  // reference instant is read at parse time so relative dates ("tomorrow")
  // resolve against the current moment in the account's time zone.
  const parsed = useMemo(() => {
    const trimmed = title.trim();
    if (!hydrated || trimmed === "") {
      return null;
    }
    return parseCapture(trimmed, {
      reference: new Date().toISOString(),
      timeZone,
      locale,
    });
  }, [title, hydrated, timeZone, locale]);

  const visibleChips = parsed
    ? parsed.chips.filter((chip) => !removed.has(chip.kind))
    : [];
  const detectedTime = removed.has("time")
    ? null
    : (parsed?.schedule.time ?? null);
  const detectedDuration = removed.has("duration")
    ? null
    : (parsed?.schedule.durationMinutes ?? null);
  // The date backing a confirmed Event, derived the same way removals are
  // honored for time and duration. An explicit date is shown as a chip and is
  // dropped when that chip is removed — so we never confirm on a date the user
  // rejected. A bare time carries no date chip, so its implied day still stands
  // (there is nothing to remove). Either way a confirmable Event needs a
  // surviving time.
  const eventDate =
    detectedTime && !removed.has("date")
      ? (parsed?.schedule.date ?? null)
      : null;
  const canConfirmEvent = Boolean(detectedTime && eventDate);

  function resetInput() {
    setTitle("");
    setRemoved(new Set());
    inputRef.current?.focus();
  }

  async function onCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "") {
      return;
    }

    // Store the raw capture verbatim: classification happens later and nothing
    // the parser noticed is discarded.
    await captureInboxItem(db, trimmed);
    setStatus(
      parsed?.hasSchedule
        ? { text: "Saved to Inbox.", addDetailsTitle: null }
        : {
            text: "Saved to Inbox · No schedule detected.",
            addDetailsTitle: trimmed,
          },
    );
    resetInput();
    void sync();
  }

  async function onConfirmEvent() {
    const trimmed = title.trim();
    if (trimmed === "" || !detectedTime || !eventDate) {
      return;
    }

    // The detected date and time are already validated wall-clock values, so
    // combining them into an instant is safe. Confirming is the classification,
    // so the Event is created directly through the offline mutation path,
    // preserving the detected duration.
    await createEvent(db, {
      title: parsed?.cleanedTitle || trimmed,
      startAt: instantFromLocalParts(eventDate, detectedTime, timeZone),
      timeZone,
      durationMinutes: detectedDuration ?? DEFAULT_DURATION_MINUTES,
    });
    setStatus({ text: "Added to your calendar.", addDetailsTitle: null });
    resetInput();
    void sync();
  }

  function removeChip(kind: ChipKind) {
    setRemoved((previous) => {
      const next = new Set(previous);
      next.add(kind);
      return next;
    });
  }

  return (
    <form
      aria-label="Quick capture"
      className="flex flex-col gap-2"
      onSubmit={onCapture}
    >
      <label className="text-sm font-medium" htmlFor={inputId}>
        Quick capture
      </label>
      <div className="flex gap-2">
        <Input
          autoComplete="off"
          disabled={!hydrated}
          id={inputId}
          maxLength={INBOX_TITLE_MAX_LENGTH}
          name="title"
          onChange={(event) => {
            setTitle(event.target.value);
            setRemoved(new Set());
            if (status) {
              setStatus(null);
            }
          }}
          placeholder="What's on your mind?"
          ref={inputRef}
          value={title}
        />
        <Button disabled={!hydrated || title.trim() === ""} type="submit">
          Capture
        </Button>
      </div>

      {visibleChips.length > 0 ? (
        <div className="flex flex-col gap-2 pt-1">
          <CaptureChips chips={visibleChips} onRemove={removeChip} />
          {canConfirmEvent ? (
            <div>
              <Button
                onClick={() => void onConfirmEvent()}
                size="sm"
                type="button"
                variant="outline"
              >
                Confirm as event
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground">
        <p role="status">{status ? status.text : ""}</p>
        {/* The action lives outside the live region: announcements shouldn't
            contain focusable controls. */}
        {status?.addDetailsTitle ? (
          <Link
            className={
              buttonVariants({ size: "sm", variant: "link" }) + " h-auto p-0"
            }
            href={`/tasks/new?title=${encodeURIComponent(status.addDetailsTitle)}`}
          >
            Add details
          </Link>
        ) : null}
      </div>
    </form>
  );
}
