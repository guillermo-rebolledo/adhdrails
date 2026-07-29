// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_REMINDER_PREFERENCES } from "@/domain/notification/reminder";
import { getClientDatabase } from "@/offline/db";
import { OfflineProvider } from "@/offline/provider";

import { InAppReminderCues, InAppReminderList } from "./in-app-reminder-cues";

describe("InAppReminderList", () => {
  it("shows timed Task and Event cues without creating Event notifications", () => {
    render(
      <InAppReminderList
        events={[
          {
            id: "event-1",
            title: "Team check-in",
            startAt: "2026-08-04T13:00:00.000Z",
            isAllDay: false,
          },
        ]}
        locale="en-US"
        nowIso="2026-08-04T12:55:00.000Z"
        preferences={DEFAULT_REMINDER_PREFERENCES}
        tasks={[
          {
            id: "task-1",
            title: "Send the draft",
            scheduledDate: "2026-08-04",
            scheduledTime: "09:00",
          },
          {
            id: "task-2",
            title: "Plan the week",
            scheduledDate: "2026-08-04",
            scheduledTime: null,
          },
        ]}
        timeZone="America/New_York"
      />,
    );

    expect(screen.getByText(/Send the draft/)).toBeVisible();
    expect(screen.getByText(/Team check-in/)).toBeVisible();
    expect(screen.queryByText(/Plan the week/)).not.toBeInTheDocument();
    expect(screen.getByText(/in-app cue/i)).toBeVisible();
  });

  it("reads fallback cues from the durable local replica while offline", async () => {
    const accountId = `offline-reminders-${crypto.randomUUID()}`;
    const db = getClientDatabase(accountId);
    const now = new Date();
    const soon = new Date(now.getTime() + 5 * 60_000);
    const scheduledDate = soon.toISOString().slice(0, 10);
    const scheduledTime = soon.toISOString().slice(11, 16);
    await db.tasks.put({
      id: crypto.randomUUID(),
      title: "Cached timed Task",
      status: "active",
      scheduledDate,
      scheduledTime,
      estimateMinutes: null,
      energy: null,
      important: false,
      notes: "",
      areaId: null,
      completedAt: null,
      version: 1,
      createdAt: now.toISOString(),
      deletedAt: null,
      syncState: "synced",
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    render(
      <OfflineProvider accountId={accountId}>
        <InAppReminderCues
          locale="en-US"
          preferences={DEFAULT_REMINDER_PREFERENCES}
          timeZone="UTC"
        />
      </OfflineProvider>,
    );

    expect(await screen.findByText(/Cached timed Task/)).toBeVisible();
  });
});
