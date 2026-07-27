import { cn } from "@/lib/utils";

import {
  eventStatePresentation,
  type EventStateInput,
  type EventStateKind,
} from "./event-state";

/**
 * A calm, numberless synchronization cue for an Event. It communicates state
 * through a quiet label and tone rather than a count or alarm — Rails never
 * pressures the user. The full description is exposed to assistive technology so
 * the cue is not visual-only.
 */
const toneClasses: Record<EventStateKind, string> = {
  local: "bg-muted text-muted-foreground",
  synced: "bg-muted text-muted-foreground",
  stale: "bg-muted text-muted-foreground",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  review: "bg-destructive/15 text-destructive",
};

export function SyncBadge({ origin, syncState, stale }: EventStateInput) {
  const presentation = eventStatePresentation({ origin, syncState, stale });

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        toneClasses[presentation.kind],
      )}
    >
      <span aria-hidden="true">{presentation.label}</span>
      <span className="sr-only">{presentation.description}</span>
    </span>
  );
}
