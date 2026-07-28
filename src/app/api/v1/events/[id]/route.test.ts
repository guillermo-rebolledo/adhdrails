import { describe, expect, it, vi } from "vitest";

import type { EventRecord } from "@/server/event/repository";
import type { EventUpdateResult } from "@/server/event/service";

import { createEventItemRouteHandlers } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

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
    version: 2,
    idempotencyKey: KEY,
    createdAt: new Date("2026-07-20T10:00:00.000Z"),
    updatedAt: new Date("2026-07-20T10:00:00.000Z"),
    ...overrides,
  };
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    listInWindow: vi.fn(),
    listLater: vi.fn(),
    ...overrides,
  };
}

const patch = (body: unknown) =>
  new Request(`https://rails.example/api/v1/events/${ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const updateBody = {
  idempotencyKey: KEY,
  baseVersion: 1,
  patch: { title: "Renamed" },
};

describe("PATCH /api/v1/events/[id]", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { PATCH } = createEventItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    expect((await PATCH(patch(updateBody), ID)).status).toBe(401);
  });

  it("applies an update and returns the event", async () => {
    const update = vi.fn().mockResolvedValue({
      ok: true,
      item: record({ title: "Renamed" }),
      applied: true,
    } satisfies EventUpdateResult);
    const { PATCH } = createEventItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ update }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(patch(updateBody), ID);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ title: "Renamed" });
  });

  it("routes a recurring-series edit to Google with 422", async () => {
    const update = vi.fn().mockResolvedValue({
      ok: false,
      reason: "recurring_series",
    } satisfies EventUpdateResult);
    const { PATCH } = createEventItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ update }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await PATCH(patch(updateBody), ID);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "recurring_series_edit",
    });
  });
});

describe("DELETE /api/v1/events/[id]", () => {
  it("removes the event and acknowledges", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const { DELETE } = createEventItemRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ remove }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await DELETE(
      new Request(`https://rails.example/api/v1/events/${ID}`, {
        method: "DELETE",
      }),
      ID,
    );

    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith("user_1", ID);
  });
});
