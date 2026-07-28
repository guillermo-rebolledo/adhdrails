import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_PREFERENCES,
  dueTaskReminders,
  isEventCueDue,
  isTaskCueDue,
  safePushPayload,
} from "./reminder";

describe("dueTaskReminders", () => {
  it("does not schedule a date-only Task", () => {
    expect(
      dueTaskReminders(
        { id: "task-1", scheduledDate: "2026-08-04", scheduledTime: null },
        "America/Mexico_City",
        DEFAULT_REMINDER_PREFERENCES,
        "2026-08-04T14:49:30.000Z",
      ),
    ).toEqual([]);
  });

  it("selects the configured heads-up reminder in the account timezone", () => {
    expect(
      dueTaskReminders(
        {
          id: "task-1",
          scheduledDate: "2026-08-04",
          scheduledTime: "09:00",
        },
        "America/New_York",
        { ...DEFAULT_REMINDER_PREFERENCES, enabled: true },
        "2026-08-04T12:50:30.000Z",
      ),
    ).toEqual([
      {
        kind: "heads_up",
        scheduledFor: "2026-08-04T12:50:00Z",
        taskId: "task-1",
      },
    ]);
  });

  it("selects an at-time reminder independently", () => {
    expect(
      dueTaskReminders(
        {
          id: "task-1",
          scheduledDate: "2026-11-01",
          scheduledTime: "09:00",
        },
        "America/New_York",
        {
          ...DEFAULT_REMINDER_PREFERENCES,
          enabled: true,
          headsUpEnabled: false,
          atTimeEnabled: true,
        },
        "2026-11-01T14:00:20.000Z",
      ),
    ).toEqual([
      {
        kind: "at_time",
        scheduledFor: "2026-11-01T14:00:00Z",
        taskId: "task-1",
      },
    ]);
  });

  it("returns no browser reminders when the master switch is off", () => {
    expect(
      dueTaskReminders(
        {
          id: "task-1",
          scheduledDate: "2026-08-04",
          scheduledTime: "09:00",
        },
        "UTC",
        { ...DEFAULT_REMINDER_PREFERENCES, enabled: false },
        "2026-08-04T08:50:30.000Z",
      ),
    ).toEqual([]);
  });
});

describe("in-app reminders", () => {
  it("keeps a timed Task cue available when browser reminders are off", () => {
    expect(
      isTaskCueDue(
        {
          id: "task-1",
          scheduledDate: "2026-08-04",
          scheduledTime: "09:00",
        },
        "America/New_York",
        DEFAULT_REMINDER_PREFERENCES,
        "2026-08-04T12:55:00.000Z",
      ),
    ).toBe(true);
  });

  it("shows an Event cue only during the 15 minutes before a timed Event", () => {
    expect(
      isEventCueDue("2026-08-04T15:00:00.000Z", "2026-08-04T14:45:00.000Z"),
    ).toBe(true);
    expect(
      isEventCueDue("2026-08-04T15:00:00.000Z", "2026-08-04T14:44:59.000Z"),
    ).toBe(false);
  });

  it("uses content-safe Web Push payloads with no Task or Event text", () => {
    const payload = safePushPayload("heads_up");

    expect(payload).toEqual({
      kind: "timed-task",
      moment: "heads_up",
      href: "/today",
    });
    expect(JSON.stringify(payload)).not.toContain("Write the report");
  });
});
