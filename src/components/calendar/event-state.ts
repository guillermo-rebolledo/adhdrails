import type { EventOrigin } from "@/domain/event/event";
import type { SyncState } from "@/offline/db";

/**
 * The calm, non-numeric cue the agenda shows for an Event's synchronization
 * state. Rails works fully without Google Calendar access, so the cue never
 * blocks anything — it only explains where an Event stands:
 *
 * - `local` — a Rails-owned Event, synchronized to the Rails server.
 * - `synced` — a mirrored Google Calendar Event, current as far as Rails knows.
 * - `stale` — mirrored data whose freshness is not yet confirmed (a background
 *   refresh is pending); shown for the server-owned Later view while its query
 *   is revalidating.
 * - `pending` — a local change not yet delivered to the server.
 * - `review` — a change that conflicted or repeatedly failed to sync and is
 *   retained for the user to review rather than silently dropped.
 */
export type EventStateKind =
  | "local"
  | "synced"
  | "stale"
  | "pending"
  | "review";

export interface EventStatePresentation {
  kind: EventStateKind;
  label: string;
  /** A longer, screen-reader-friendly description of the state. */
  description: string;
}

export interface EventStateInput {
  origin: EventOrigin;
  syncState: SyncState;
  /** Whether the surrounding server view is revalidating (mirror may be stale). */
  stale?: boolean;
}

/**
 * Resolves an Event's synchronization cue. Pending and review states take
 * precedence over origin, since an unsynced local change matters more to the
 * user than where the Event came from. A confirmed Event is either a Google
 * mirror (`synced`, or `stale` while revalidating) or a Rails-owned `local`
 * Event.
 */
export function eventStatePresentation(
  input: EventStateInput,
): EventStatePresentation {
  if (input.syncState === "pending") {
    return {
      kind: "pending",
      label: "Pending",
      description: "This change hasn't synced yet.",
    };
  }

  if (input.syncState === "conflict" || input.syncState === "failed") {
    return {
      kind: "review",
      label: "Needs review",
      description: "This change couldn't sync and is kept for review.",
    };
  }

  if (input.origin === "google") {
    return input.stale
      ? {
          kind: "stale",
          label: "Refreshing",
          description: "Showing recent calendar data while it refreshes.",
        }
      : {
          kind: "synced",
          label: "Synced",
          description: "Synchronized with Google Calendar.",
        };
  }

  return {
    kind: "local",
    label: "Local",
    description: "A local event saved in Rails.",
  };
}
