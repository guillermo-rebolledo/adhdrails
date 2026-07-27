// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { type AgendaEvent, EventCard } from "./event-card";

const NY = "America/New_York";

function event(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    id: "e1",
    title: "Dentist",
    startAt: "2026-07-20T13:00:00Z",
    endAt: "2026-07-20T13:30:00Z",
    startTimeZone: NY,
    endTimeZone: NY,
    isAllDay: false,
    origin: "local",
    status: "confirmed",
    syncState: "synced",
    ...overrides,
  };
}

describe("EventCard", () => {
  it("renders a timed event's local clock range", () => {
    render(<EventCard event={event()} locale="en-US" timeZone={NY} />);
    // 13:00Z is 09:00 in New York; the range is shown (ICU may use special
    // spaces, so match loosely on the digits).
    expect(screen.getByText(/9:00/)).toBeInTheDocument();
  });

  it("renders an imported all-day event as 'All day' rather than a clock range", () => {
    render(
      <EventCard
        event={event({
          title: "Company offsite",
          isAllDay: true,
          origin: "google",
        })}
        locale="en-US"
        timeZone={NY}
      />,
    );
    expect(screen.getByText("All day")).toBeInTheDocument();
    expect(screen.queryByText(/9:00|AM|PM/)).not.toBeInTheDocument();
  });

  it("notes a differing time zone for a timed event", () => {
    render(
      <EventCard
        event={event({
          startTimeZone: "Europe/Berlin",
          endTimeZone: "Europe/Berlin",
        })}
        locale="en-US"
        timeZone={NY}
      />,
    );
    expect(screen.getByText(/Europe\/Berlin/)).toBeInTheDocument();
  });
});
