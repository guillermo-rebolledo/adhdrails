import { describe, expect, it, vi } from "vitest";

import type { EventRecord } from "@/server/event/repository";
import type { EventCreateResult } from "@/server/event/service";

import { createEventsRouteHandlers } from "./route";

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
    version: 1,
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
    remove: vi.fn(),
    listInWindow: vi.fn().mockResolvedValue([]),
    listLater: vi.fn(),
    ...overrides,
  };
}

const request = {
  id: ID,
  title: "Dentist",
  startAt: "2026-07-20T13:00:00.000Z",
  endAt: "2026-07-20T13:30:00.000Z",
  startTimeZone: "America/New_York",
  endTimeZone: "America/New_York",
  idempotencyKey: KEY,
};

const post = (body?: unknown) =>
  new Request("https://rails.example/api/v1/events", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("POST /api/v1/events", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { POST } = createEventsRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    expect((await POST(post(request))).status).toBe(401);
  });

  it("creates a timed event with 201", async () => {
    const create = vi.fn().mockResolvedValue({
      ok: true,
      item: record(),
      created: true,
    } satisfies EventCreateResult);
    const { POST } = createEventsRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ create }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post(request));

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith("user_1", request);
    await expect(response.json()).resolves.toMatchObject({
      id: ID,
      title: "Dentist",
      origin: "local",
      status: "confirmed",
    });
  });

  it("refuses to resurrect a tombstoned event with 410", async () => {
    const create = vi.fn().mockResolvedValue({
      ok: false,
      reason: "gone",
    } satisfies EventCreateResult);
    const { POST } = createEventsRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ create }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await POST(post(request));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ code: "gone" });
  });
});

describe("GET /api/v1/events", () => {
  it("lists events in the requested window", async () => {
    const listInWindow = vi.fn().mockResolvedValue([record()]);
    const { GET } = createEventsRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service({ listInWindow }) as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request(
        "https://rails.example/api/v1/events?from=2026-07-20T04:00:00Z&to=2026-07-27T04:00:00Z",
      ),
    );

    expect(response.status).toBe(200);
    expect(listInWindow).toHaveBeenCalledWith(
      "user_1",
      new Date("2026-07-20T04:00:00Z"),
      new Date("2026-07-27T04:00:00Z"),
    );
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: ID, title: "Dentist" }],
    });
  });

  it("rejects a missing window with 422", async () => {
    const { GET } = createEventsRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "user_1" }),
      getService: () => service() as never,
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(
      new Request("https://rails.example/api/v1/events"),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "validation_failed",
    });
  });
});
