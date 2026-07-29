import { describe, expect, it } from "vitest";

import { DEFAULT_REMINDER_PREFERENCES } from "@/domain/notification/reminder";

import {
  DATA_EXPORT_SCHEMA_VERSION,
  buildDataExportDocument,
  dataExportFilename,
  dataExportStatusSchema,
  isDataExportExpired,
  type DataExportSource,
} from "./data-export";

function source(overrides: Partial<DataExportSource> = {}): DataExportSource {
  return {
    account: {
      name: "Person Example",
      email: "person@example.com",
      timezone: "America/New_York",
      locale: "en-US",
    },
    areas: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Deep work",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    tasks: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Write the report",
        status: "active",
        scheduledDate: "2026-02-01",
        scheduledTime: "09:00",
        estimateMinutes: 25,
        energy: "high",
        important: true,
        notes: "outline first",
        areaId: "11111111-1111-4111-8111-111111111111",
        completedAt: null,
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    ],
    thoughts: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Book idea",
        body: "a calm productivity memoir",
        createdAt: "2026-01-04T00:00:00.000Z",
        updatedAt: "2026-01-04T00:00:00.000Z",
      },
    ],
    inboxItems: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        title: "Call the dentist",
        seenAt: null,
        classifiedAt: null,
        createdAt: "2026-01-05T00:00:00.000Z",
        updatedAt: "2026-01-05T00:00:00.000Z",
      },
    ],
    events: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        title: "Local dentist appointment",
        startAt: "2026-02-02T14:00:00.000Z",
        endAt: "2026-02-02T14:30:00.000Z",
        startTimeZone: "America/New_York",
        endTimeZone: "America/New_York",
        isAllDay: false,
        allDayStartDate: null,
        allDayEndDate: null,
        status: "confirmed",
        origin: "local",
        googleCalendarId: null,
        googleEventId: null,
        createdAt: "2026-01-06T00:00:00.000Z",
        updatedAt: "2026-01-06T00:00:00.000Z",
      },
    ],
    focusSessions: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        taskId: "22222222-2222-4222-8222-222222222222",
        status: "completed",
        accumulatedSeconds: 1500,
        distractionCount: 2,
        startedAt: "2026-01-07T10:00:00.000Z",
        completedAt: "2026-01-07T10:25:00.000Z",
        createdAt: "2026-01-07T10:00:00.000Z",
        updatedAt: "2026-01-07T10:25:00.000Z",
      },
    ],
    reminderPreferences: null,
    ...overrides,
  };
}

const EXPORTED_AT = "2026-02-10T12:00:00.000Z";

describe("buildDataExportDocument", () => {
  it("stamps the schema version and export time", () => {
    const document = buildDataExportDocument(source(), EXPORTED_AT);

    expect(document.schemaVersion).toBe(DATA_EXPORT_SCHEMA_VERSION);
    expect(document.exportedAt).toBe(EXPORTED_AT);
  });

  it("includes every app-owned collection", () => {
    const document = buildDataExportDocument(source(), EXPORTED_AT);

    expect(document.account.email).toBe("person@example.com");
    expect(document.areas).toHaveLength(1);
    expect(document.tasks[0].title).toBe("Write the report");
    expect(document.thoughts[0].title).toBe("Book idea");
    expect(document.inboxItems[0].title).toBe("Call the dentist");
    expect(document.focusSessions[0].accumulatedSeconds).toBe(1500);
  });

  it("excludes mirrored Google Events, keeping only local ones", () => {
    const document = buildDataExportDocument(
      source({
        events: [
          ...source().events,
          {
            id: "77777777-7777-4777-8777-777777777777",
            title: "Synced standup",
            startAt: "2026-02-03T09:00:00.000Z",
            endAt: "2026-02-03T09:15:00.000Z",
            startTimeZone: "America/New_York",
            endTimeZone: "America/New_York",
            isAllDay: false,
            allDayStartDate: null,
            allDayEndDate: null,
            status: "confirmed",
            origin: "synced",
            googleCalendarId: "primary@example.com",
            googleEventId: "abc123",
            createdAt: "2026-01-08T00:00:00.000Z",
            updatedAt: "2026-01-08T00:00:00.000Z",
          },
        ],
      }),
      EXPORTED_AT,
    );

    expect(document.events).toHaveLength(1);
    expect(document.events[0].title).toBe("Local dentist appointment");
  });

  it("never leaks provider identifiers or origin onto exported Events", () => {
    const serialized = JSON.stringify(
      buildDataExportDocument(source(), EXPORTED_AT),
    );

    expect(serialized).not.toContain("googleCalendarId");
    expect(serialized).not.toContain("googleEventId");
    expect(serialized).not.toContain("origin");
  });

  it("falls back to default reminder preferences when none are stored", () => {
    const document = buildDataExportDocument(source(), EXPORTED_AT);

    expect(document.preferences.reminders).toEqual(
      DEFAULT_REMINDER_PREFERENCES,
    );
  });

  it("carries stored reminder preferences through unchanged", () => {
    const reminders = {
      ...DEFAULT_REMINDER_PREFERENCES,
      enabled: true,
      leadMinutes: 30 as const,
    };
    const document = buildDataExportDocument(
      source({ reminderPreferences: reminders }),
      EXPORTED_AT,
    );

    expect(document.preferences.reminders).toEqual(reminders);
  });
});

describe("isDataExportExpired", () => {
  const now = new Date("2026-02-10T12:00:00.000Z");

  it("is never expired without an expiry instant", () => {
    expect(isDataExportExpired(null, now)).toBe(false);
  });

  it("is expired once the expiry instant has passed", () => {
    expect(isDataExportExpired(new Date("2026-02-10T11:59:59.000Z"), now)).toBe(
      true,
    );
  });

  it("is not expired before the expiry instant", () => {
    expect(isDataExportExpired(new Date("2026-02-10T12:00:01.000Z"), now)).toBe(
      false,
    );
  });
});

describe("dataExportFilename", () => {
  it("names the archive by its completion date", () => {
    expect(dataExportFilename(new Date("2026-02-10T12:34:56.000Z"))).toBe(
      "rails-export-2026-02-10.json",
    );
  });
});

describe("dataExportStatusSchema", () => {
  it("accepts every lifecycle state", () => {
    for (const status of [
      "pending",
      "processing",
      "completed",
      "failed",
      "expired",
    ]) {
      expect(dataExportStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects an unknown state", () => {
    expect(dataExportStatusSchema.safeParse("archived").success).toBe(false);
  });
});
