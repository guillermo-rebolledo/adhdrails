import { describe, expect, it } from "vitest";

import {
  decodeEventCursor,
  encodeEventCursor,
  groupEventsByMonth,
  monthKeyInZone,
  paginate,
} from "./later";

const NY = "America/New_York";

describe("monthKeyInZone", () => {
  it("uses the local month, not the UTC month", () => {
    // 2026-08-01T02:00Z is still July 31st at 22:00 in New York.
    expect(monthKeyInZone("2026-08-01T02:00:00Z", NY)).toBe("2026-07");
    expect(monthKeyInZone("2026-08-01T12:00:00Z", NY)).toBe("2026-08");
  });
});

describe("groupEventsByMonth", () => {
  it("groups a start-ordered list into consecutive month sections preserving order", () => {
    const events = [
      { id: "a", startAt: "2026-08-03T12:00:00Z" },
      { id: "b", startAt: "2026-08-20T12:00:00Z" },
      { id: "c", startAt: "2026-09-01T12:00:00Z" },
      { id: "d", startAt: "2026-11-15T12:00:00Z" },
    ];

    const groups = groupEventsByMonth(events, NY);

    expect(groups.map((group) => group.month)).toEqual([
      "2026-08",
      "2026-09",
      "2026-11",
    ]);
    expect(groups[0].events.map((event) => event.id)).toEqual(["a", "b"]);
    expect(groups[2].events.map((event) => event.id)).toEqual(["d"]);
  });
});

describe("event cursor", () => {
  it("round-trips a compound (startAt, id) cursor", () => {
    const cursor = { startAt: "2026-09-01T12:00:00Z", id: "abc-123" };
    expect(decodeEventCursor(encodeEventCursor(cursor))).toEqual(cursor);
  });

  it("returns null for malformed or non-instant cursors", () => {
    expect(decodeEventCursor("")).toBeNull();
    expect(decodeEventCursor("not-base64-with-no-separator")).toBeNull();
    expect(
      decodeEventCursor(Buffer.from("nope|id", "utf8").toString("base64url")),
    ).toBeNull();
    expect(
      decodeEventCursor(
        Buffer.from("2026-09-01T12:00:00Z|", "utf8").toString("base64url"),
      ),
    ).toBeNull();
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    id: `id-${index}`,
    startAt: `2026-09-0${index + 1}T12:00:00Z`,
  }));

  it("returns a full page and a next cursor when more rows exist", () => {
    // Fetched limit+1 (4) with a limit of 3 -> one extra row signals more.
    const { items, nextCursor } = paginate(rows, 3);
    expect(items).toHaveLength(3);
    expect(nextCursor).toBe(
      encodeEventCursor({ startAt: rows[2].startAt, id: rows[2].id }),
    );
  });

  it("signals exhaustion with a null cursor when no extra row exists", () => {
    const { items, nextCursor } = paginate(rows.slice(0, 2), 3);
    expect(items).toHaveLength(2);
    expect(nextCursor).toBeNull();
  });
});
