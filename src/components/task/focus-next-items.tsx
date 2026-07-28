"use client";

import { Button } from "@/components/ui/button";
import { formatTime } from "@/domain/calendar/format";
import type { NextItem, NextItems } from "@/domain/focus/next-items";

/**
 * The deliberate "what's next" list shown after a Focus Session, chosen only
 * when the user asks for it. Today's remaining Events and scheduled Tasks lead
 * (time-sensitive context first), then available unscheduled Tasks. Nothing
 * starts on its own — a Task offers an explicit "Focus on this", and an Event is
 * informational, because Rails suggests without taking control.
 */
export function FocusNextItems({
  items,
  timeZone,
  locale,
  onFocusTask,
}: {
  items: NextItems;
  timeZone: string;
  locale: string;
  /** Starts a new session for the chosen Task; never called automatically. */
  onFocusTask: (taskId: string) => void;
}) {
  const isEmpty =
    items.timeSensitive.length === 0 && items.flexible.length === 0;

  if (isEmpty) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing else is lined up for today. Rest, capture a thought, or pick
        something up when you’re ready — there’s no rush.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {items.timeSensitive.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Coming up
          </h4>
          <ul aria-label="Coming up" className="flex flex-col gap-2">
            {items.timeSensitive.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <NextRow
                  item={item}
                  locale={locale}
                  onFocusTask={onFocusTask}
                  timeZone={timeZone}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {items.flexible.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            When you’re ready
          </h4>
          <ul aria-label="When you're ready" className="flex flex-col gap-2">
            {items.flexible.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <NextRow
                  item={item}
                  locale={locale}
                  onFocusTask={onFocusTask}
                  timeZone={timeZone}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function NextRow({
  item,
  timeZone,
  locale,
  onFocusTask,
}: {
  item: NextItem;
  timeZone: string;
  locale: string;
  onFocusTask: (taskId: string) => void;
}) {
  const when = item.startAt ? formatTime(item.startAt, timeZone, locale) : null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-card-foreground">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{item.title}</span>
        <span className="text-xs text-muted-foreground">
          {item.kind === "event"
            ? when
              ? `Event · ${when}`
              : "Event"
            : when
              ? `Scheduled · ${when}`
              : "Task"}
        </span>
      </div>
      {item.kind === "task" ? (
        <Button
          aria-label={`Focus on ${item.title}`}
          onClick={() => onFocusTask(item.id)}
          size="sm"
          variant="outline"
        >
          Focus on this
        </Button>
      ) : null}
    </div>
  );
}
