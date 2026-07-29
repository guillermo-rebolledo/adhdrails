// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectionResponse } from "@/domain/calendar/connection";

import { CalendarSettings } from "./calendar-settings";

const refresh = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
  refresh.mockClear();
  searchParams = new URLSearchParams();
});

function connected(
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
      {
        googleCalendarId: "holidays",
        summary: "Holidays",
        accessRole: "reader",
        timeZone: null,
        primary: false,
        isVisible: true,
        isWritable: false,
      },
    ],
    ...overrides,
  };
}

describe("CalendarSettings — not connected", () => {
  it("offers a connect link to the incremental authorization flow", () => {
    render(
      <CalendarSettings
        connection={null}
        accountTimezone="UTC"
        accountLocale="en-US"
      />,
    );

    const link = screen.getByTestId("connect-calendar");
    expect(link).toHaveAttribute(
      "href",
      "/api/calendar/authorize?return=/settings",
    );
  });

  it("shows a calm cue when a prior attempt was denied", () => {
    searchParams = new URLSearchParams("calendar=denied");
    render(
      <CalendarSettings
        connection={null}
        accountTimezone="UTC"
        accountLocale="en-US"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /works fully without Calendar access/i,
    );
  });
});

describe("CalendarSettings — connected", () => {
  it("shows when the calendar mirror was last synced", () => {
    render(
      <CalendarSettings
        connection={connected({ lastSyncedAt: "2026-07-27T13:00:00.000Z" })}
        accountTimezone="America/New_York"
        accountLocale="en-US"
      />,
    );

    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
  });

  it("omits the last-synced line before the first import", () => {
    render(
      <CalendarSettings
        connection={connected({ lastSyncedAt: null })}
        accountTimezone="America/New_York"
        accountLocale="en-US"
      />,
    );

    expect(screen.queryByText(/Last synced/)).not.toBeInTheDocument();
  });

  it("prevents choosing a read-only calendar as the write target", () => {
    render(
      <CalendarSettings
        connection={connected()}
        accountTimezone="America/New_York"
        accountLocale="en-US"
      />,
    );

    const writableRadios = screen.getAllByRole("radio", {
      name: /new events here/i,
    });
    // Personal (owner) is enabled; Holidays (reader) is disabled.
    expect(writableRadios[0]).toBeEnabled();
    expect(writableRadios[1]).toBeDisabled();
  });

  it("saves the selection with the toggled visibility and writable target", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const user = userEvent.setup();
    render(
      <CalendarSettings
        connection={connected()}
        accountTimezone="America/New_York"
        accountLocale="en-US"
      />,
    );

    // Hide the Holidays calendar.
    await user.click(screen.getByRole("checkbox", { name: /Holidays/i }));
    await user.click(screen.getByRole("button", { name: /save calendars/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/calendar/selection");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(
      body.selections.find(
        (s: { googleCalendarId: string }) => s.googleCalendarId === "holidays",
      ).isVisible,
    ).toBe(false);
  });

  it("keeps the local selection and announces a standard save error", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          type: "https://rails.app/problems/validation-failed",
          title: "Invalid request",
          status: 422,
          code: "validation_failed",
          detail: "Choose a writable calendar you can edit.",
          correlationId: "calendar-test",
          retryable: false,
        },
        { status: 422 },
      ),
    );
    const user = userEvent.setup();
    render(
      <CalendarSettings
        connection={connected()}
        accountTimezone="America/New_York"
        accountLocale="en-US"
      />,
    );

    const holidays = screen.getByRole("checkbox", { name: /Holidays/i });
    await user.click(holidays);
    await user.click(screen.getByRole("button", { name: /save calendars/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a writable calendar you can edit.",
    );
    expect(holidays).not.toBeChecked();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers to adopt the primary calendar timezone when it differs", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const user = userEvent.setup();
    render(
      <CalendarSettings
        connection={connected()}
        accountTimezone="UTC"
        accountLocale="en-US"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Use America\/New_York/ }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/account");
    expect(JSON.parse(init.body)).toEqual({
      timezone: "America/New_York",
      locale: "en-US",
    });
  });

  it("does not offer the timezone when it already matches the account", () => {
    render(
      <CalendarSettings
        connection={connected()}
        accountTimezone="America/New_York"
        accountLocale="en-US"
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Use America/ }),
    ).not.toBeInTheDocument();
  });

  it("confirms before disconnecting and then calls the disconnect endpoint", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const user = userEvent.setup();
    render(
      <CalendarSettings
        connection={connected()}
        accountTimezone="America/New_York"
        accountLocale="en-US"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /disconnect google calendar/i }),
    );
    // Confirmation appears; nothing sent yet.
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Disconnect$/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/calendar/connection");
    expect(init.method).toBe("DELETE");
  });

  it("does not claim Calendar was disconnected when the server refuses", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          type: "https://rails.app/problems/database-unavailable",
          title: "Temporarily unavailable",
          status: 503,
          code: "database_unavailable",
          detail: "Calendar could not be disconnected. Please try again.",
          correlationId: "disconnect-test",
          retryable: true,
        },
        { status: 503 },
      ),
    );
    const user = userEvent.setup();
    render(
      <CalendarSettings
        connection={connected()}
        accountTimezone="America/New_York"
        accountLocale="en-US"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /disconnect google calendar/i }),
    );
    await user.click(screen.getByRole("button", { name: /^Disconnect$/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Calendar could not be disconnected. Please try again.",
    );
    expect(
      screen.getByRole("group", { name: "Confirm disconnect" }),
    ).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });
});
