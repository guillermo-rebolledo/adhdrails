// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgendaRow } from "./agenda-row";
import type { AgendaEvent } from "./event-card";

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

function renderRow(agendaEvent: AgendaEvent, timeZone = NY) {
  return render(
    <ul>
      <AgendaRow event={agendaEvent} locale="en-US" timeZone={timeZone} />
    </ul>,
  );
}

describe("AgendaRow", () => {
  it("renders a timed event's local clock range", () => {
    renderRow(event());
    // 13:00Z is 09:00 in New York; the range is shown (ICU may use special
    // spaces, so match loosely on the digits).
    expect(screen.getByText(/9:00/)).toBeInTheDocument();
  });

  it("renders the whole title rather than an abbreviation", () => {
    const title =
      "Horizon roadmap check-in with the platform team and their partners";
    renderRow(event({ title }));
    expect(screen.getByText(title)).toBeInTheDocument();
  });

  it("renders an imported all-day event as 'All day' rather than a clock range", () => {
    renderRow(
      event({ title: "Company offsite", isAllDay: true, origin: "google" }),
    );
    expect(screen.getByText("All day")).toBeInTheDocument();
    expect(screen.queryByText(/9:00|AM|PM/)).not.toBeInTheDocument();
  });

  it("renders a foreign-zone event on the account's clock", () => {
    // Authored as 3:00 PM in Berlin; a New York account reads it as 9:00 AM.
    renderRow(
      event({ startTimeZone: "Europe/Berlin", endTimeZone: "Europe/Berlin" }),
    );
    expect(screen.getByText(/9:00/)).toBeInTheDocument();
    expect(screen.queryByText(/3:00 – 3:30/)).not.toBeInTheDocument();
  });

  it("still shows the original wall-clock start for a foreign-zone event", () => {
    renderRow(
      event({ startTimeZone: "Europe/Berlin", endTimeZone: "Europe/Berlin" }),
    );
    expect(screen.getByText(/3:00.*Europe\/Berlin/)).toBeInTheDocument();
  });

  it("omits the original when the event matches the account's zone", () => {
    renderRow(event());
    expect(screen.queryByText(new RegExp(NY))).not.toBeInTheDocument();
  });

  it("carries the event's synchronization cue", () => {
    renderRow(event({ origin: "google", syncState: "synced" }));
    expect(screen.getByText("Synced")).toBeInTheDocument();
  });
});
