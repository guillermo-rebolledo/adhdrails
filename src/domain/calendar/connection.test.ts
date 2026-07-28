import { describe, expect, it } from "vitest";

import {
  type AvailableCalendar,
  defaultSelection,
  isWritableRole,
  primaryTimeZoneOf,
  validateSelection,
} from "./connection";

function calendar(
  overrides: Partial<AvailableCalendar> = {},
): AvailableCalendar {
  return {
    googleCalendarId: "primary@example.com",
    summary: "Personal",
    accessRole: "owner",
    timeZone: "America/New_York",
    primary: true,
    ...overrides,
  };
}

describe("isWritableRole", () => {
  it("accepts owner and writer, rejects reader and freeBusyReader", () => {
    expect(isWritableRole("owner")).toBe(true);
    expect(isWritableRole("writer")).toBe(true);
    expect(isWritableRole("reader")).toBe(false);
    expect(isWritableRole("freeBusyReader")).toBe(false);
  });
});

describe("validateSelection", () => {
  const available = [
    calendar({ googleCalendarId: "own", accessRole: "owner" }),
    calendar({
      googleCalendarId: "shared",
      accessRole: "reader",
      primary: false,
    }),
    calendar({
      googleCalendarId: "team",
      accessRole: "writer",
      primary: false,
    }),
  ];

  it("accepts a single writable calendar with a writable role", () => {
    expect(
      validateSelection(available, [
        { googleCalendarId: "own", isVisible: true, isWritable: true },
        { googleCalendarId: "shared", isVisible: true, isWritable: false },
      ]),
    ).toEqual({ ok: true });
  });

  it("accepts a selection with no writable calendar", () => {
    expect(
      validateSelection(available, [
        { googleCalendarId: "shared", isVisible: true, isWritable: false },
      ]),
    ).toEqual({ ok: true });
  });

  it("rejects making a read-only shared calendar writable", () => {
    expect(
      validateSelection(available, [
        { googleCalendarId: "shared", isVisible: true, isWritable: true },
      ]),
    ).toEqual({ ok: false, reason: "readonly_writable" });
  });

  it("rejects more than one writable calendar", () => {
    expect(
      validateSelection(available, [
        { googleCalendarId: "own", isVisible: true, isWritable: true },
        { googleCalendarId: "team", isVisible: true, isWritable: true },
      ]),
    ).toEqual({ ok: false, reason: "multiple_writable" });
  });

  it("rejects a calendar the account does not have", () => {
    expect(
      validateSelection(available, [
        { googleCalendarId: "ghost", isVisible: true, isWritable: false },
      ]),
    ).toEqual({ ok: false, reason: "unknown_calendar" });
  });
});

describe("defaultSelection", () => {
  it("makes every calendar visible and the primary calendar writable", () => {
    const result = defaultSelection([
      calendar({ googleCalendarId: "own", primary: true, accessRole: "owner" }),
      calendar({
        googleCalendarId: "shared",
        primary: false,
        accessRole: "reader",
      }),
    ]);

    expect(result.every((c) => c.isVisible)).toBe(true);
    expect(result.find((c) => c.googleCalendarId === "own")?.isWritable).toBe(
      true,
    );
    expect(
      result.find((c) => c.googleCalendarId === "shared")?.isWritable,
    ).toBe(false);
  });

  it("falls back to the first writable-role calendar when none is primary", () => {
    const result = defaultSelection([
      calendar({
        googleCalendarId: "shared",
        primary: false,
        accessRole: "reader",
      }),
      calendar({
        googleCalendarId: "team",
        primary: false,
        accessRole: "writer",
      }),
    ]);

    expect(result.find((c) => c.googleCalendarId === "team")?.isWritable).toBe(
      true,
    );
  });

  it("leaves a read-only-only account with no writable calendar", () => {
    const result = defaultSelection([
      calendar({ googleCalendarId: "a", primary: false, accessRole: "reader" }),
      calendar({
        googleCalendarId: "b",
        primary: false,
        accessRole: "freeBusyReader",
      }),
    ]);

    expect(result.some((c) => c.isWritable)).toBe(false);
  });
});

describe("primaryTimeZoneOf", () => {
  it("returns the primary calendar's IANA timezone", () => {
    expect(
      primaryTimeZoneOf([
        calendar({ primary: true, timeZone: "Europe/Madrid" }),
        calendar({ googleCalendarId: "x", primary: false }),
      ]),
    ).toBe("Europe/Madrid");
  });

  it("returns null when the primary timezone is missing or invalid", () => {
    expect(
      primaryTimeZoneOf([calendar({ primary: true, timeZone: null })]),
    ).toBeNull();
    expect(
      primaryTimeZoneOf([calendar({ primary: true, timeZone: "Not/AZone" })]),
    ).toBeNull();
  });
});
