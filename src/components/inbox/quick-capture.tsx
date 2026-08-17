"use client";

import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";

import { CaptureChips } from "@/components/inbox/capture-chips";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/domain/account/onboarding";
import { instantFromLocalParts } from "@/domain/calendar/agenda";
import { type ChipKind, parseCapture } from "@/domain/capture/parser";
import { INBOX_TITLE_MAX_LENGTH } from "@/domain/inbox/capture";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";
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

  // Adopt anything typed before React took over. The field is live from first
  // paint and uncontrolled, so text typed ahead of hydration is still sitting
  // in the node but nothing in React knows about it yet. Reading it once on
  // mount hands it to state, which lights up the parser chips and the Capture
  // button as if it had been typed a moment later.
  useEffect(() => {
    const typedBeforeHydration = inputRef.current?.value ?? "";
    if (typedBeforeHydration !== "") {
      setTitle(typedBeforeHydration);
    }
  }, []);

  // The field is uncontrolled, so clearing it means clearing the node as well
  // as the state that mirrors it for the parser.
  function resetInput() {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    setTitle("");
    setRemoved(new Set());
    inputRef.current?.focus();
  }

  async function onCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read the field itself rather than state. They agree in every ordinary
    // case, but a submit that races the hydration adopt-back above would see an
    // empty `title` and silently drop the capture — the exact failure this
    // whole surface exists to prevent.
    const submitted = new FormData(event.currentTarget).get("title");
    const trimmed = (typeof submitted === "string" ? submitted : title).trim();
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
        {/*
          The field is deliberately not gated on hydration. This is the first
          thing on Today and the whole promise of the surface is that a thought
          can be dumped before it escapes — a capture box that ignores typing
          until a JS bundle arrives breaks that promise at exactly the moment it
          matters, and does it silently.

          What did need gating is the submit button below: until React attaches
          its handler, activating it triggers a native form submission that
          navigates away and takes the text with it. So the field accepts input
          from first paint, the effect above adopts whatever landed in it, and
          only the commit action waits.
        */}
        <Input
          autoComplete="off"
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
        />
        <Button disabled={!hydrated || title.trim() === ""} type="submit">
          Capture
        </Button>
      </div>

      {/*
        The parser proposes chips mid-sentence, so this region appears while the
        user is still typing. Snapping it into the layout shoved everything
        below it down between keystrokes — an unannounced jump directly under
        the cursor, in the one box built for people who lose the thought when
        something interrupts them.

        Growing the region instead keeps the proposal peripheral: it arrives
        without taking the eye off the input, and the movement itself is what
        says "something was noticed" — no alert needed. Same `0fr`/`1fr` reveal
        as the Today disclosure, so the two read as one behavior.
      */}
      {/* `inert` rather than `aria-hidden`: the region holds the chip-removal
          and confirm buttons, and a collapsed region that is hidden from
          assistive tech but still reachable by Tab is worse than not hiding it
          at all. `inert` takes it out of both. */}
      <div
        inert={visibleChips.length === 0}
        className={cn(
          "grid transition-[grid-template-rows] duration-(--motion-calm) ease-enter motion-reduce:transition-none",
          visibleChips.length > 0 ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
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
        </div>
      </div>

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
