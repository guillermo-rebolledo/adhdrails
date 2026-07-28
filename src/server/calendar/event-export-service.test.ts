import { describe, expect, it } from "vitest";

import type { EventRecord } from "@/server/event/repository";
import type { ExportJobRecord } from "@/server/event/export-job-repository";

import { createEventExportService } from "./event-export-service";
import { createFakeGoogleAdapter } from "./fake-google-adapter";
import type { ConnectionRecord } from "./repository";
import type { TokenCipher } from "./token-cipher";

const USER = "user_1";
const EVENT_ID = "11111111-1111-4111-8111-111111111111";

function eventRecord(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: EVENT_ID,
    title: "Standup",
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
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    createdAt: new Date("2026-07-27T10:00:00.000Z"),
    updatedAt: new Date("2026-07-27T10:00:00.000Z"),
    ...overrides,
  };
}

function job(overrides: Partial<ExportJobRecord> = {}): ExportJobRecord {
  return {
    id: "job-1",
    userId: USER,
    eventId: EVENT_ID,
    operation: "upsert",
    googleCalendarId: "writable@example.com",
    googleEventId: null,
    status: "processing",
    attempts: 1,
    lastErrorCode: null,
    ...overrides,
  };
}

const connection = {
  encryptedRefreshToken: {
    ciphertext: "ct",
    nonce: "n",
    authTag: "t",
    keyVersion: 1,
  },
} as ConnectionRecord;

const cipher = { decrypt: () => "refresh-1" } as unknown as TokenCipher;

/** An in-memory Event repository slice the export service reads and writes back. */
function eventStore(initial: EventRecord) {
  const events = new Map<string, EventRecord>([[initial.id, initial]]);
  return {
    events,
    repository: {
      getById: async (_userId: string, id: string) => events.get(id) ?? null,
      linkGoogleIdentity: async (
        _userId: string,
        id: string,
        identity: { googleCalendarId: string; googleEventId: string },
      ) => {
        const current = events.get(id);
        if (current) {
          events.set(id, {
            ...current,
            googleCalendarId: identity.googleCalendarId,
            googleEventId: identity.googleEventId,
          });
        }
      },
    } as never,
  };
}

function calendarRepo(record: ConnectionRecord | null) {
  return { getConnection: async () => record } as never;
}

function service(
  event: EventRecord,
  options: {
    connection?: ConnectionRecord | null;
    adapter?: ReturnType<typeof createFakeGoogleAdapter>;
  } = {},
) {
  const adapter = options.adapter ?? createFakeGoogleAdapter();
  const store = eventStore(event);
  const exportService = createEventExportService({
    calendarRepository: calendarRepo(
      options.connection === undefined ? connection : options.connection,
    ),
    eventRepository: store.repository,
    adapter,
    cipher,
  });
  return { adapter, store, exportService };
}

describe("createEventExportService.exportEvent (upsert)", () => {
  it("creates a new local event on the writable calendar and links its id", async () => {
    const { adapter, store, exportService } = service(eventRecord());

    const result = await exportService.exportEvent(job());

    expect(result).toEqual({ ok: true, outcome: "created" });
    expect(adapter.insertRequests).toHaveLength(1);
    expect(adapter.insertRequests[0].calendarId).toBe("writable@example.com");
    expect(adapter.insertRequests[0].body.summary).toBe("Standup");
    // The Google id is written back so the mirror sync never duplicates it.
    expect(store.events.get(EVENT_ID)?.googleEventId).toBe("g-created-1");
  });

  it("is idempotent: a second run patches instead of creating a duplicate", async () => {
    const { adapter, exportService } = service(eventRecord());

    await exportService.exportEvent(job());
    const second = await exportService.exportEvent(job());

    expect(second).toEqual({ ok: true, outcome: "patched" });
    expect(adapter.insertRequests).toHaveLength(1);
    expect(adapter.patchRequests).toHaveLength(1);
    expect(adapter.patchRequests[0].googleEventId).toBe("g-created-1");
  });

  it("patches an already mirrored event on its own calendar", async () => {
    const { adapter, exportService } = service(
      eventRecord({
        origin: "google",
        googleCalendarId: "mirror@example.com",
        googleEventId: "g-existing",
      }),
    );

    const result = await exportService.exportEvent(
      job({ googleCalendarId: "mirror@example.com" }),
    );

    expect(result).toEqual({ ok: true, outcome: "patched" });
    expect(adapter.patchRequests[0].calendarId).toBe("mirror@example.com");
    expect(adapter.patchRequests[0].googleEventId).toBe("g-existing");
    expect(adapter.insertRequests).toHaveLength(0);
  });

  it("skips when the event was deleted before its export ran", async () => {
    const { adapter, store, exportService } = service(eventRecord());
    store.events.clear();

    const result = await exportService.exportEvent(job());

    expect(result).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "event_absent",
    });
    expect(adapter.insertRequests).toHaveLength(0);
  });

  it("skips an all-day event rather than writing it", async () => {
    const { adapter, exportService } = service(eventRecord({ isAllDay: true }));

    const result = await exportService.exportEvent(job());

    expect(result).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "all_day",
    });
    expect(adapter.insertRequests).toHaveLength(0);
  });

  it("skips a recurring event, routing it to Google", async () => {
    const { adapter, exportService } = service(
      eventRecord({ recurringEventId: "series-1" }),
    );

    const result = await exportService.exportEvent(job());

    expect(result).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "recurring",
    });
    expect(adapter.insertRequests).toHaveLength(0);
  });

  it("skips when there is no writable calendar to create on", async () => {
    const { exportService } = service(eventRecord());

    const result = await exportService.exportEvent(
      job({ googleCalendarId: null }),
    );

    expect(result).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "no_writable_calendar",
    });
  });
});

describe("createEventExportService.exportEvent (delete)", () => {
  it("deletes the identified Google event", async () => {
    const { adapter, exportService } = service(eventRecord());

    const result = await exportService.exportEvent(
      job({
        operation: "delete",
        googleCalendarId: "writable@example.com",
        googleEventId: "g-1",
      }),
    );

    expect(result).toEqual({ ok: true, outcome: "deleted" });
    expect(adapter.deleteRequests).toEqual([
      { calendarId: "writable@example.com", googleEventId: "g-1" },
    ]);
  });

  it("skips a delete for an event never mirrored to Google", async () => {
    const { adapter, exportService } = service(eventRecord());

    const result = await exportService.exportEvent(
      job({ operation: "delete", googleCalendarId: null, googleEventId: null }),
    );

    expect(result).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "nothing_to_delete",
    });
    expect(adapter.deleteRequests).toHaveLength(0);
  });
});

describe("createEventExportService.exportEvent failures", () => {
  it("reports not_connected when Calendar was disconnected", async () => {
    const { exportService } = service(eventRecord(), { connection: null });

    const result = await exportService.exportEvent(job());

    expect(result).toEqual({ ok: false, reason: "not_connected" });
  });

  it("reports unauthorized when the grant can no longer refresh (revoked)", async () => {
    const adapter = {
      ...createFakeGoogleAdapter(),
      refreshAccessToken: async () => {
        throw new Error("invalid_grant");
      },
    } as ReturnType<typeof createFakeGoogleAdapter>;
    const store = eventStore(eventRecord());
    const svc = createEventExportService({
      calendarRepository: calendarRepo(connection),
      eventRepository: store.repository,
      adapter,
      cipher,
    });

    const result = await svc.exportEvent(job());

    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("propagates a transient Google write failure for the runner to retry", async () => {
    const adapter = createFakeGoogleAdapter({
      writeError: new Error("google 503"),
    });
    const { exportService } = service(eventRecord(), { adapter });

    await expect(exportService.exportEvent(job())).rejects.toThrow(
      "google 503",
    );
  });
});
