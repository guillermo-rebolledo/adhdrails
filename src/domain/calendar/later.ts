import { Temporal } from "temporal-polyfill";

/**
 * Pure helpers for the Later list: the Events scheduled beyond the current
 * agenda week, grouped by month and paged with a stable compound cursor. Like
 * the rest of the calendar domain this is framework-free and shared by the
 * server view and its tests. The cursor is a stable `(startAt, id)` pair — never
 * an offset — so inserts and deletes never shift a page boundary underneath a
 * "Load more".
 */

/** The default Later page size: enough to browse, small enough to stay fast. */
export const LATER_PAGE_SIZE = 20;

export interface LaterItem {
  id: string;
  startAt: string;
}

/** One month section of the Later list. */
export interface MonthGroup<T extends LaterItem> {
  /** The local year-month as `YYYY-MM` in the viewing time zone. */
  month: string;
  events: T[];
}

/** The local year-month (`YYYY-MM`) an instant falls in, in `timeZone`. */
export function monthKeyInZone(iso: string, timeZone: string): string {
  const zoned = Temporal.Instant.from(iso).toZonedDateTimeISO(timeZone);
  return `${zoned.year.toString().padStart(4, "0")}-${zoned.month
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Groups an already start-ordered list of Later Events into consecutive month
 * sections, keyed by each Event's start in `timeZone`. Input order is
 * preserved, so a caller that sorts by `(startAt, id)` gets chronological months
 * each holding chronological Events.
 */
export function groupEventsByMonth<T extends LaterItem>(
  events: readonly T[],
  timeZone: string,
): MonthGroup<T>[] {
  const groups: MonthGroup<T>[] = [];

  for (const event of events) {
    const month = monthKeyInZone(event.startAt, timeZone);
    const last = groups.at(-1);
    if (last && last.month === month) {
      last.events.push(event);
    } else {
      groups.push({ month, events: [event] });
    }
  }

  return groups;
}

export interface EventCursor {
  startAt: string;
  id: string;
}

const CURSOR_SEPARATOR = "|";

/**
 * Encodes a compound `(startAt, id)` cursor as an opaque, URL-safe token. The
 * pair is unique and monotonic under the Later list's `(startAt, id)` ordering,
 * so paging is stable across concurrent inserts and deletes.
 */
export function encodeEventCursor(cursor: EventCursor): string {
  const raw = `${cursor.startAt}${CURSOR_SEPARATOR}${cursor.id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * Decodes a cursor token, returning `null` for anything malformed so a bad or
 * truncated cursor degrades to "start from the beginning" rather than throwing.
 */
export function decodeEventCursor(token: string): EventCursor | null {
  let raw: string;
  try {
    raw = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const separator = raw.indexOf(CURSOR_SEPARATOR);
  if (separator === -1) {
    return null;
  }

  const startAt = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (startAt === "" || id === "") {
    return null;
  }

  // Reject a start that is not a valid instant so a corrupt cursor can't drive a
  // meaningless comparison against the stored column.
  try {
    Temporal.Instant.from(startAt);
  } catch {
    return null;
  }

  return { startAt, id };
}

/**
 * Splits a page fetched with one extra row (`limit + 1`) into the page itself
 * and the cursor for the next page. When fewer than `limit + 1` rows come back
 * the list is exhausted and `nextCursor` is `null`.
 */
export function paginate<T extends LaterItem>(
  rows: readonly T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) {
    return { items: rows.slice(), nextCursor: null };
  }
  const items = rows.slice(0, limit);
  const last = items.at(-1)!;
  return {
    items,
    nextCursor: encodeEventCursor({ startAt: last.startAt, id: last.id }),
  };
}
