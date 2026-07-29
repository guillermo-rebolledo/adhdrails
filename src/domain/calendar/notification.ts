/**
 * Pure rules for Google Calendar push notifications (MEM-41). A watch on a
 * calendar's events resource makes Google POST a header-only notification to our
 * webhook whenever that calendar changes; the body is empty and the notification
 * never says *what* changed, only that the resource moved. This module classifies
 * those headers into an intent the webhook can act on and decides when a stored
 * watch is close enough to expiry to renew. It has no React, Next.js, Drizzle, or
 * network dependencies; the server layer reads the headers, verifies the token,
 * and enqueues the incremental sync.
 *
 * @see https://developers.google.com/calendar/api/guides/push
 */

/** The raw notification header values the webhook extracts, each nullable. */
export interface RawNotificationHeaders {
  /** `X-Goog-Channel-ID`: the channel id Rails chose when opening the watch. */
  channelId: string | null;
  /** `X-Goog-Channel-Token`: the opaque verification token Rails set. */
  token: string | null;
  /** `X-Goog-Resource-ID`: Google's stable id for the watched resource. */
  resourceId: string | null;
  /** `X-Goog-Resource-State`: `sync` | `exists` | `not_exists`. */
  resourceState: string | null;
  /** `X-Goog-Message-Number`: a per-channel strictly increasing integer. */
  messageNumber: string | null;
}

/**
 * The classified intent of a notification:
 * - `handshake` — the `sync` message Google sends once, right after the watch is
 *   created, to confirm delivery. It carries no change and must only be
 *   acknowledged.
 * - `change` — the calendar's events resource moved; the webhook should enqueue
 *   an incremental sync for the channel's calendar after verifying `token`.
 * - `ignore` — a well-formed notification that carries nothing to act on.
 * - `invalid` — required headers are missing or malformed; the webhook cannot
 *   trust or route it.
 */
export type CalendarNotification =
  | { kind: "handshake"; channelId: string; resourceId: string }
  | {
      kind: "change";
      channelId: string;
      token: string | null;
      resourceId: string;
      messageNumber: number;
    }
  | { kind: "ignore"; reason: string }
  | { kind: "invalid"; reason: string };

/**
 * Classifies a set of notification headers. A notification is only routable when
 * it names a channel and resource; the initial `sync` state is a handshake, and
 * `exists`/`not_exists` are treated identically as "this calendar changed, go
 * resync" because Google's incremental `events.list` — not the notification —
 * carries the actual additions, edits, and deletions.
 */
export function interpretCalendarNotification(
  headers: RawNotificationHeaders,
): CalendarNotification {
  const channelId = headers.channelId?.trim();
  const resourceId = headers.resourceId?.trim();
  const resourceState = headers.resourceState?.trim();

  if (!channelId || !resourceId || !resourceState) {
    return { kind: "invalid", reason: "missing_headers" };
  }

  if (resourceState === "sync") {
    return { kind: "handshake", channelId, resourceId };
  }

  if (resourceState !== "exists" && resourceState !== "not_exists") {
    return { kind: "ignore", reason: `unhandled_state:${resourceState}` };
  }

  const messageNumber = Number.parseInt(headers.messageNumber ?? "", 10);
  if (!Number.isInteger(messageNumber) || messageNumber <= 0) {
    return { kind: "invalid", reason: "bad_message_number" };
  }

  return {
    kind: "change",
    channelId,
    token: headers.token?.trim() ?? null,
    resourceId,
    messageNumber,
  };
}

/**
 * Constant-time-ish equality for the channel verification token. A watch stores
 * the token Rails generated; a notification whose token does not match the stored
 * one is rejected before any provider work, so a spoofed or stale channel cannot
 * drive a sync. Returns false when either side is absent.
 */
export function channelTokenMatches(
  expected: string | null | undefined,
  provided: string | null | undefined,
): boolean {
  if (!expected || !provided || expected.length !== provided.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return mismatch === 0;
}

/** How long before a watch expires that Rails proactively renews it. */
export const WATCH_RENEWAL_LEAD_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a watch should be renewed now: it has no recorded expiry, or its expiry
 * falls within {@link WATCH_RENEWAL_LEAD_MS} of `now` (already past included). A
 * generous lead means a missed renewal still leaves time before Google stops
 * delivering notifications, after which periodic reconciliation is the backstop.
 */
export function watchNeedsRenewal(
  expiresAt: Date | null,
  now: Date,
  leadMs: number = WATCH_RENEWAL_LEAD_MS,
): boolean {
  if (!expiresAt) {
    return true;
  }
  return expiresAt.getTime() - now.getTime() <= leadMs;
}
