// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_REMINDER_PREFERENCES } from "@/domain/notification/reminder";

import { InAppReminderList } from "./in-app-reminder-cues";

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
});
