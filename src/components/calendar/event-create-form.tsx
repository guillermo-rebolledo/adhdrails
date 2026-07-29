"use client";

import { type FormEvent, useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Temporal } from "temporal-polyfill";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { instantFromLocalParts } from "@/domain/calendar/agenda";
import { EVENT_TITLE_MAX_LENGTH } from "@/domain/event/event";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { createEvent } from "@/offline/event-commands";
import { useOffline } from "@/offline/provider";

const DRAFT_KEY = "event-new";

/** The duration options offered at creation; 30 minutes is the MVP default. */
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;
const DEFAULT_DURATION = 30;

// A client-only default keeps the server and first client render in agreement
// (both start empty) and fills a sensible value once mounted — no setState in an
// effect, mirroring the useLocalDraft pattern.
const noopSubscribe = () => () => {};

function useClientDefault(compute: () => string): string {
  return useSyncExternalStore(noopSubscribe, compute, () => "");
}

/**
 * The dedicated full-page local Event creation flow. A user can create a timed
 * Event without any Google Calendar access: it is written to the local replica,
 * acknowledged immediately, and delivered to the server by the sync engine in
 * the background. Date and time are entered as wall-clock values in an explicit
 * IANA time zone and combined into an unambiguous instant. The end defaults to
 * 30 minutes after the start. All-day and recurring Events are not creatable
 * here by design — they arrive only through Google import.
 */
export function EventCreateForm({ timeZone }: { timeZone: string }) {
  const { db, sync } = useOffline();
  const router = useRouter();
  const titleId = useId();
  const dateId = useId();
  const timeId = useId();
  const durationId = useId();
  const zoneId = useId();

  const draft = useLocalDraft(DRAFT_KEY);
  const defaultDate = useClientDefault(() =>
    Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate().toString(),
  );
  const defaultTime = useClientDefault(() => "09:00");
  const [editedDate, setEditedDate] = useState<string | null>(null);
  const [editedTime, setEditedTime] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [zone, setZone] = useState(timeZone);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // `null` means "untouched" — fall back to the client-seeded default until the
  // user edits, so no effect ever writes state.
  const date = editedDate ?? defaultDate;
  const time = editedTime ?? defaultTime;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.value.trim();
    if (title === "" || date === "" || time === "" || submitting) {
      return;
    }

    let startAt: string;
    try {
      startAt = instantFromLocalParts(date, time, zone);
    } catch {
      setError("That date, time, or time zone isn't valid.");
      return;
    }

    setSubmitting(true);
    try {
      await createEvent(db, {
        title,
        startAt,
        timeZone: zone,
        durationMinutes: duration,
      });
    } catch {
      setSubmitting(false);
      setError(
        "That event couldn't be saved. Check the details and try again.",
      );
      return;
    }
    draft.clear();
    void sync();
    router.push("/calendar");
  }

  return (
    <form
      aria-label="New event"
      className="flex flex-col gap-4"
      onSubmit={onSubmit}
    >
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={titleId}>
          Event title
        </label>
        <Input
          autoComplete="off"
          autoFocus
          id={titleId}
          maxLength={EVENT_TITLE_MAX_LENGTH}
          name="title"
          onChange={(event) => draft.setValue(event.target.value)}
          placeholder="What's happening?"
          value={draft.value}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor={dateId}>
            Date
          </label>
          <Input
            id={dateId}
            name="date"
            onChange={(event) => setEditedDate(event.target.value)}
            type="date"
            value={date}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor={timeId}>
            Start time
          </label>
          <Input
            id={timeId}
            name="time"
            onChange={(event) => setEditedTime(event.target.value)}
            type="time"
            value={time}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor={durationId}>
            Duration
          </label>
          <select
            className="h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
            id={durationId}
            name="duration"
            onChange={(event) => setDuration(Number(event.target.value))}
            value={duration}
          >
            {DURATION_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor={zoneId}>
            Time zone
          </label>
          <Input
            id={zoneId}
            name="timeZone"
            onChange={(event) => setZone(event.target.value)}
            value={zone}
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          disabled={
            draft.value.trim() === "" ||
            date === "" ||
            time === "" ||
            submitting
          }
          type="submit"
        >
          Create event
        </Button>
        <Link className={buttonVariants({ variant: "ghost" })} href="/calendar">
          Cancel
        </Link>
      </div>
    </form>
  );
}
