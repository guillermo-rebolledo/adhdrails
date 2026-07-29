import { describe, expect, it, vi } from "vitest";

import { encodeEventCursor } from "@/domain/calendar/later";

import type { EventRecord } from "./repository";
import { createEventService } from "./service";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const OTHER_KEY = "33333333-3333-4333-8333-333333333333";

function record(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: ID,
    title: "Dentist",
    startAt: new Date("2026-07-20T13:00:00.000Z"),
    endAt: new Date("2026-07-20T13:30:00.000Z"),
    startTimeZone: "America/New_York",
    endTimeZone: "America/New_York",
    isAllDay: false,
    allDayStartDate: null,
    allDayEndDate: null,
    recurringEventId: null,
    recurrence: null,
    status: "confirmed",
    origin: "local",
    googleCalendarId: null,
    googleEventId: null,
    version: 1,
    idempotencyKey: KEY,
    createdAt: new Date("2026-07-20T10:00:00.000Z"),
    updatedAt: new Date("2026-07-20T10:00:00.000Z"),
    ...overrides,
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    getById: vi.fn().mockResolvedValue(null),
    isTombstoned: vi.fn().mockResolvedValue(false),
    insert: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listInWindow: vi.fn(),
    listLater: vi.fn(),
    ...overrides,
  } as never;
}

const createRequest = {
  id: ID,
  title: "Dentist",
  startAt: "2026-07-20T13:00:00.000Z",
  endAt: "2026-07-20T13:30:00.000Z",
  startTimeZone: "America/New_York",
  endTimeZone: "America/New_York",
  idempotencyKey: KEY,
};

describe("createEventService.create", () => {
  it("rejects an invalid create before touching the repository", async () => {
    const insert = vi.fn();
    const service = createEventService(repository({ insert }));

    const result = await service.create("user_1", {
      ...createRequest,
      endAt: createRequest.startAt,
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts a fresh timed event", async () => {
    const insert = vi.fn().mockResolvedValue(record());
    const service = createEventService(repository({ insert }));

    const result = await service.create("user_1", createRequest);

    expect(insert).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ id: ID }),
    );
    expect(result).toMatchObject({ ok: true, created: true });
  });

  it("replays a duplicate delivery without inserting again", async () => {
    const insert = vi.fn();
    const service = createEventService(
      repository({ getById: vi.fn().mockResolvedValue(record()), insert }),
    );

    const result = await service.create("user_1", createRequest);

    expect(result).toMatchObject({ ok: true, created: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("reports a conflict when a different event already holds the id", async () => {
    const service = createEventService(
      repository({
        getById: vi
          .fn()
          .mockResolvedValue(
            record({ title: "Different", idempotencyKey: OTHER_KEY }),
          ),
      }),
    );

    const result = await service.create("user_1", createRequest);

    expect(result).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("refuses to resurrect a tombstoned id", async () => {
    const service = createEventService(
      repository({ isTombstoned: vi.fn().mockResolvedValue(true) }),
    );

    const result = await service.create("user_1", createRequest);

    expect(result).toMatchObject({ ok: false, reason: "gone" });
  });
});

describe("createEventService.update", () => {
  const updateRequest = {
    idempotencyKey: OTHER_KEY,
    baseVersion: 1,
    patch: { title: "Renamed" },
  };

  it("applies an update and bumps the version", async () => {
    const update = vi
      .fn()
      .mockResolvedValue(record({ title: "Renamed", version: 2 }));
    const service = createEventService(
      repository({ getById: vi.fn().mockResolvedValue(record()), update }),
    );

    const result = await service.update("user_1", ID, updateRequest);

    expect(update).toHaveBeenCalledWith(
      "user_1",
      ID,
      expect.objectContaining({ version: 2, idempotencyKey: OTHER_KEY }),
    );
    expect(result).toMatchObject({ ok: true, applied: true });
  });

  it("reports a conflict on a stale base version", async () => {
    const service = createEventService(
      repository({
        getById: vi.fn().mockResolvedValue(record({ version: 3 })),
      }),
    );

    const result = await service.update("user_1", ID, updateRequest);

    expect(result).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("is not_found when the event is absent", async () => {
    const service = createEventService(repository());

    const result = await service.update("user_1", ID, updateRequest);

    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("routes a recurring-series edit to Google instead of applying it", async () => {
    const update = vi.fn();
    const service = createEventService(
      repository({
        getById: vi
          .fn()
          .mockResolvedValue(record({ recurringEventId: "series-1" })),
        update,
      }),
    );

    const result = await service.update("user_1", ID, updateRequest);

    expect(result).toMatchObject({ ok: false, reason: "recurring_series" });
    expect(update).not.toHaveBeenCalled();
  });

  it("exports an edit to an already mirrored event to its own calendar", async () => {
    const update = vi.fn().mockResolvedValue(record({ version: 2 }));
    const writableCalendar = {
      get: vi.fn().mockResolvedValue({ googleCalendarId: "writable@x" }),
    };
    const service = createEventService(
      repository({
        getById: vi.fn().mockResolvedValue(
          record({
            origin: "google",
            googleCalendarId: "mirror@x",
            googleEventId: "g-1",
          }),
        ),
        update,
      }),
      { writableCalendar },
    );

    await service.update("user_1", ID, updateRequest);

    // A mirrored event exports to its own calendar; the writable target is not
    // consulted.
    expect(update).toHaveBeenCalledWith("user_1", ID, expect.anything(), {
      googleCalendarId: "mirror@x",
    });
    expect(writableCalendar.get).not.toHaveBeenCalled();
  });

  it("exports a local edit to the selected writable calendar", async () => {
    const update = vi.fn().mockResolvedValue(record({ version: 2 }));
    const writableCalendar = {
      get: vi.fn().mockResolvedValue({ googleCalendarId: "writable@x" }),
    };
    const service = createEventService(
      repository({ getById: vi.fn().mockResolvedValue(record()), update }),
      { writableCalendar },
    );

    await service.update("user_1", ID, updateRequest);

    expect(update).toHaveBeenCalledWith("user_1", ID, expect.anything(), {
      googleCalendarId: "writable@x",
    });
  });

  it("keeps a local edit local when no writable calendar is selected", async () => {
    const update = vi.fn().mockResolvedValue(record({ version: 2 }));
    const writableCalendar = { get: vi.fn().mockResolvedValue(null) };
    const service = createEventService(
      repository({ getById: vi.fn().mockResolvedValue(record()), update }),
      { writableCalendar },
    );

    await service.update("user_1", ID, updateRequest);

    expect(update).toHaveBeenCalledWith(
      "user_1",
      ID,
      expect.objectContaining({ version: 2 }),
    );
  });
});

describe("createEventService.create export decisioning", () => {
  it("exports a new local event to the selected writable calendar", async () => {
    const insert = vi.fn().mockResolvedValue(record());
    const writableCalendar = {
      get: vi.fn().mockResolvedValue({ googleCalendarId: "writable@x" }),
    };
    const service = createEventService(repository({ insert }), {
      writableCalendar,
    });

    await service.create("user_1", createRequest);

    expect(insert).toHaveBeenCalledWith("user_1", expect.anything(), {
      googleCalendarId: "writable@x",
    });
  });

  it("keeps a new local event local when no writable calendar is selected", async () => {
    const insert = vi.fn().mockResolvedValue(record());
    const writableCalendar = { get: vi.fn().mockResolvedValue(null) };
    const service = createEventService(repository({ insert }), {
      writableCalendar,
    });

    await service.create("user_1", createRequest);

    expect(insert).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ id: ID }),
    );
  });
});

describe("createEventService.listLater", () => {
  const from = new Date("2026-07-27T00:00:00.000Z");

  function laterRecord(index: number): EventRecord {
    const day = String(index + 1).padStart(2, "0");
    return record({
      id: `id-${index}`,
      startAt: new Date(`2026-08-${day}T12:00:00.000Z`),
      endAt: new Date(`2026-08-${day}T12:30:00.000Z`),
    });
  }

  it("returns a page and a next cursor when an extra row is fetched", async () => {
    const rows = [0, 1, 2].map(laterRecord);
    const listLater = vi.fn().mockResolvedValue(rows);
    const service = createEventService(repository({ listLater }));

    const page = await service.listLater("user_1", from, null, 2);

    // Fetches pageSize + 1 rows.
    expect(listLater).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ from, cursor: null, limit: 3 }),
    );
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(
      encodeEventCursor({
        startAt: rows[1].startAt.toISOString(),
        id: rows[1].id,
      }),
    );
  });

  it("returns a null cursor when the list is exhausted", async () => {
    const rows = [0, 1].map(laterRecord);
    const service = createEventService(
      repository({ listLater: vi.fn().mockResolvedValue(rows) }),
    );

    const page = await service.listLater("user_1", from, null, 2);

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("decodes an incoming cursor and forwards it to the repository", async () => {
    const listLater = vi.fn().mockResolvedValue([]);
    const service = createEventService(repository({ listLater }));
    const cursor = encodeEventCursor({
      startAt: "2026-08-01T12:00:00.000Z",
      id: "id-0",
    });

    await service.listLater("user_1", from, cursor, 2);

    expect(listLater).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        cursor: { startAt: "2026-08-01T12:00:00.000Z", id: "id-0" },
      }),
    );
  });
});
