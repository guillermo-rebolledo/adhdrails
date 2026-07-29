import { formatTime } from "@/domain/calendar/format";

/**
 * The calm, one-line status the agenda shows for the Google Calendar mirror.
 * Rails works fully without Calendar access, so a not-connected account simply
 * gets no line (null). Otherwise it communicates whether the mirror is currently
 * refreshing, temporarily unavailable, or last synchronized at a known time —
 * so old data is never mistaken for current data.
 */
export interface MirrorStatusInput {
  isSyncing: boolean;
  isError: boolean;
  lastSyncedAt: string | null;
  timeZone: string;
  locale: string;
}

export function mirrorStatusLabel(input: MirrorStatusInput): string | null {
  if (input.isSyncing) {
    return "Refreshing calendar…";
  }
  if (input.isError) {
    return "Calendar sync is unavailable right now.";
  }
  if (input.lastSyncedAt) {
    return `Last synced ${formatTime(input.lastSyncedAt, input.timeZone, input.locale)}`;
  }
  return null;
}
