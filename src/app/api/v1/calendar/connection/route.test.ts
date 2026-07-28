import { describe, expect, it, vi } from "vitest";

import type { ConnectionResponse } from "@/domain/calendar/connection";
import type { CalendarService } from "@/server/calendar/service";

import { createCalendarConnectionRouteHandlers } from "./route";

function connection(
  overrides: Partial<ConnectionResponse> = {},
): ConnectionResponse {
  return {
    status: "connected",
    primaryCalendarId: "primary@example.com",
    primaryTimeZone: "America/New_York",
    connectedAt: "2026-07-27T12:00:00.000Z",
    lastSyncedAt: null,
    calendars: [
      {
        googleCalendarId: "primary@example.com",
        summary: "Personal",
        accessRole: "owner",
        timeZone: "America/New_York",
        primary: true,
        isVisible: true,
        isWritable: true,
      },
    ],
    ...overrides,
  };
}

function service(overrides: Partial<CalendarService> = {}): CalendarService {
  return {
    buildAuthorizationUrl: vi.fn(),
    completeAuthorization: vi.fn(),
    getConnection: vi.fn(),
    saveSelection: vi.fn(),
    disconnect: vi.fn(),
    ...overrides,
  } as unknown as CalendarService;
}

describe("GET /api/v1/calendar/connection", () => {
  it("returns 401 when unauthenticated", async () => {
    const { GET } = createCalendarConnectionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service(),
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(new Request("https://rails.example/x"));
    expect(response.status).toBe(401);
  });

  it("returns null connection when Calendar is not connected", async () => {
    const getConnection = vi.fn().mockResolvedValue(null);
    const { GET } = createCalendarConnectionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () => service({ getConnection }),
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(new Request("https://rails.example/x"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connection: null });
    expect(getConnection).toHaveBeenCalledWith("u1");
  });

  it("returns the serialized connection", async () => {
    const { GET } = createCalendarConnectionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () =>
        service({ getConnection: vi.fn().mockResolvedValue(connection()) }),
      createCorrelationId: () => "cor_1",
    });

    const response = await GET(new Request("https://rails.example/x"));
    const body = (await response.json()) as { connection: ConnectionResponse };
    expect(body.connection.status).toBe("connected");
    expect(body.connection.calendars[0].isWritable).toBe(true);
  });
});

describe("DELETE /api/v1/calendar/connection", () => {
  it("disconnects and reports whether a connection existed", async () => {
    const disconnect = vi.fn().mockResolvedValue({ wasConnected: true });
    const { DELETE } = createCalendarConnectionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () => service({ disconnect }),
      createCorrelationId: () => "cor_1",
    });

    const response = await DELETE(
      new Request("https://rails.example/x", { method: "DELETE" }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ wasConnected: true });
    expect(disconnect).toHaveBeenCalledWith("u1");
  });

  it("returns 401 when unauthenticated", async () => {
    const { DELETE } = createCalendarConnectionRouteHandlers({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service(),
      createCorrelationId: () => "cor_1",
    });

    const response = await DELETE(
      new Request("https://rails.example/x", { method: "DELETE" }),
    );
    expect(response.status).toBe(401);
  });
});
