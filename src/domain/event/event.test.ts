import { describe, expect, it } from "vitest";

import { DEFAULT_EVENT_DURATION_MINUTES } from "@/domain/calendar/agenda";

import {
  eventContentEquals,
  eventCreateRequestSchema,
  eventDurationMinutes,
  eventPatchSchema,
  eventResponseSchema,
  resolveCreate,
  resolveUpdate,
  type CreateState,
} from "./event";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const OTHER_KEY = "33333333-3333-4333-8333-333333333333";

const validCreate = {
  id: ID,
  title: "Dentist",
  startAt: "2026-07-20T13:00:00Z",
  endAt: "2026-07-20T13:30:00Z",
  startTimeZone: "America/New_York",
  endTimeZone: "America/New_York",
  idempotencyKey: KEY,
};

describe("eventCreateRequestSchema", () => {
  it("accepts a well-formed 30-minute local event", () => {
    const parsed = eventCreateRequestSchema.parse(validCreate);
    expect(eventDurationMinutes(parsed)).toBe(DEFAULT_EVENT_DURATION_MINUTES);
  });

  it("rejects an end that is not after the start", () => {
    const result = eventCreateRequestSchema.safeParse({
      ...validCreate,
      endAt: validCreate.startAt,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized time zone", () => {
    const result = eventCreateRequestSchema.safeParse({
      ...validCreate,
      startTimeZone: "Mars/Olympus",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-instant start", () => {
    const result = eventCreateRequestSchema.safeParse({
      ...validCreate,
      startAt: "not-a-time",
    });
    expect(result.success).toBe(false);
  });
});

describe("eventPatchSchema", () => {
  it("requires at least one field", () => {
    expect(eventPatchSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a lone title change", () => {
    expect(eventPatchSchema.parse({ title: "Renamed" })).toEqual({
      title: "Renamed",
    });
  });

  it("rejects a start/end pair that does not end after it starts", () => {
    const result = eventPatchSchema.safeParse({
      startAt: "2026-07-20T13:00:00Z",
      endAt: "2026-07-20T12:00:00Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("eventResponseSchema", () => {
  it("represents imported all-day and recurrence fields alongside local ones", () => {
    const imported = {
      id: ID,
      title: "Company offsite",
      startAt: "2026-09-01T00:00:00Z",
      endAt: "2026-09-02T00:00:00Z",
      startTimeZone: "America/New_York",
      endTimeZone: "America/New_York",
      isAllDay: true,
      allDayStartDate: "2026-09-01",
      allDayEndDate: "2026-09-02",
      recurringEventId: "recurring-abc",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      status: "confirmed",
      origin: "google",
      version: 3,
      createdAt: "2026-07-20T10:00:00Z",
      updatedAt: "2026-07-20T10:00:00Z",
    };
    expect(eventResponseSchema.parse(imported)).toMatchObject({
      isAllDay: true,
      recurringEventId: "recurring-abc",
      origin: "google",
    });
  });
});

describe("eventContentEquals", () => {
  it("treats the same instant expressed with a different offset as equal", () => {
    expect(
      eventContentEquals(
        { ...content(), startAt: "2026-07-20T13:00:00Z" },
        { ...content(), startAt: "2026-07-20T09:00:00-04:00" },
      ),
    ).toBe(true);
  });

  it("distinguishes a different title", () => {
    expect(
      eventContentEquals(content(), { ...content(), title: "Other" }),
    ).toBe(false);
  });
});

function content() {
  return {
    title: "Dentist",
    startAt: "2026-07-20T13:00:00Z",
    endAt: "2026-07-20T13:30:00Z",
    startTimeZone: "America/New_York",
    endTimeZone: "America/New_York",
  };
}

function createState(overrides: Partial<CreateState> = {}): CreateState {
  return { ...content(), idempotencyKey: KEY, ...overrides };
}

describe("resolveCreate", () => {
  it("inserts when nothing exists", () => {
    expect(resolveCreate(null, createState())).toBe("insert");
  });

  it("replays a matching idempotency key", () => {
    expect(
      resolveCreate(createState(), createState({ title: "changed" })),
    ).toBe("replay");
  });

  it("replays identical content under a different key", () => {
    expect(
      resolveCreate(createState(), createState({ idempotencyKey: OTHER_KEY })),
    ).toBe("replay");
  });

  it("conflicts on divergent content under a different key", () => {
    expect(
      resolveCreate(
        createState(),
        createState({ idempotencyKey: OTHER_KEY, title: "Different" }),
      ),
    ).toBe("conflict");
  });

  it("is gone when tombstoned", () => {
    expect(resolveCreate(null, createState(), true)).toBe("gone");
  });
});

describe("resolveUpdate", () => {
  it("applies when the base version matches", () => {
    expect(
      resolveUpdate(
        { version: 2, idempotencyKey: KEY },
        { baseVersion: 2, idempotencyKey: OTHER_KEY },
      ),
    ).toBe("apply");
  });

  it("conflicts on a stale base version", () => {
    expect(
      resolveUpdate(
        { version: 3, idempotencyKey: KEY },
        { baseVersion: 2, idempotencyKey: OTHER_KEY },
      ),
    ).toBe("conflict");
  });

  it("replays a repeated mutation", () => {
    expect(
      resolveUpdate(
        { version: 3, idempotencyKey: KEY },
        { baseVersion: 2, idempotencyKey: KEY },
      ),
    ).toBe("replay");
  });

  it("is missing when absent and gone when tombstoned", () => {
    expect(resolveUpdate(null, { baseVersion: 1, idempotencyKey: KEY })).toBe(
      "missing",
    );
    expect(
      resolveUpdate(null, { baseVersion: 1, idempotencyKey: KEY }, true),
    ).toBe("gone");
  });
});
