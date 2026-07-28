import { describe, expect, it, vi } from "vitest";

import type { EventRecord } from "@/server/event/repository";

import { createExportLocalService } from "./export-local-service";

function localEvent(id: string): EventRecord {
  return {
    id,
    title: "Local plan",
    startAt: new Date("2026-07-27T13:00:00.000Z"),
    endAt: new Date("2026-07-27T13:30:00.000Z"),
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
    idempotencyKey: id,
    createdAt: new Date("2026-07-27T10:00:00.000Z"),
    updatedAt: new Date("2026-07-27T10:00:00.000Z"),
  };
}

describe("createExportLocalService.exportLocalEvents", () => {
  it("enqueues an upsert for every unexported local event", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const service = createExportLocalService({
      calendarRepository: {
        getWritableCalendar: vi
          .fn()
          .mockResolvedValue({ googleCalendarId: "writable@x" }),
      } as never,
      eventRepository: {
        listUnexportedLocalEvents: vi
          .fn()
          .mockResolvedValue([localEvent("a"), localEvent("b")]),
      } as never,
      exportJobRepository: { enqueue } as never,
    });

    const result = await service.exportLocalEvents("user_1");

    expect(result).toEqual({ ok: true, enqueued: 2 });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith({
      userId: "user_1",
      eventId: "a",
      operation: "upsert",
      googleCalendarId: "writable@x",
    });
  });

  it("refuses without a writable calendar", async () => {
    const enqueue = vi.fn();
    const service = createExportLocalService({
      calendarRepository: {
        getWritableCalendar: vi.fn().mockResolvedValue(null),
      } as never,
      eventRepository: { listUnexportedLocalEvents: vi.fn() } as never,
      exportJobRepository: { enqueue } as never,
    });

    const result = await service.exportLocalEvents("user_1");

    expect(result).toEqual({ ok: false, reason: "no_writable_calendar" });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
