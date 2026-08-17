// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TimeZoneProvider, useClock, useTimeZone } from "./time-zone-provider";

const BROWSER_ZONE = "America/Mexico_City";

function Probe() {
  const { timeZone, locale } = useTimeZone();
  return <span data-testid="probe">{`${timeZone} ${locale}`}</span>;
}

function OverridableProbe(props: { timeZone?: string }) {
  const { timeZone } = useClock(props);
  return <span data-testid="probe">{timeZone}</span>;
}

function renderWith(accountTimeZone: string | null, children = <Probe />) {
  return render(
    <TimeZoneProvider accountTimeZone={accountTimeZone} locale="en-US">
      {children}
    </TimeZoneProvider>,
  );
}

// jsdom resolves a real zone; pin it so the assertions are about the rule, not
// about wherever the test happens to run.
vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
  timeZone: BROWSER_ZONE,
} as Intl.ResolvedDateTimeFormatOptions);

const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockClear();
});

describe("TimeZoneProvider", () => {
  it("renders in the account's zone when it is known", async () => {
    renderWith("Europe/Madrid");
    expect(await screen.findByTestId("probe")).toHaveTextContent(
      "Europe/Madrid en-US",
    );
  });

  it("renders in the browser's zone when the account has none", async () => {
    renderWith(null);
    expect(await screen.findByTestId("probe")).toHaveTextContent(BROWSER_ZONE);
  });

  it("captures the browser's zone into an account that has none", async () => {
    renderWith(null);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/account/timezone");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ timezone: BROWSER_ZONE });
  });

  it("never captures when the account already knows its zone", async () => {
    // Includes a deliberate UTC: capture must not second-guess a real answer.
    renderWith("UTC");
    await screen.findByTestId("probe");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps rendering correctly when the capture request fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    renderWith(null);

    // The zone shown comes from the browser either way, so a failed capture is
    // invisible to the user — it only means the server learns it later.
    expect(await screen.findByTestId("probe")).toHaveTextContent(BROWSER_ZONE);
  });

  it("retries the capture when the connection returns", async () => {
    // The first load of a new account may well be offline; giving up there
    // would leave reminders scheduling on the UTC fallback indefinitely.
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    renderWith(null);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      timezone: BROWSER_ZONE,
    });
  });

  it("retries after a server fault but not after the server answers", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    renderWith(null);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The second attempt succeeded, so the question is settled and further
    // connection changes must not keep asking.
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("stops asking when the server rejects the zone", async () => {
    // A 4xx is a real answer: retrying it would only repeat the rejection.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422 });
    renderWith(null);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("stops listening once unmounted", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const { unmount } = renderWith(null);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    unmount();
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

describe("useClock", () => {
  it("prefers the provider over the static default", async () => {
    renderWith("Europe/Madrid", <OverridableProbe />);
    expect(await screen.findByTestId("probe")).toHaveTextContent(
      "Europe/Madrid",
    );
  });

  it("lets a standalone render supply its own zone", async () => {
    renderWith("Europe/Madrid", <OverridableProbe timeZone="Asia/Tokyo" />);
    expect(await screen.findByTestId("probe")).toHaveTextContent("Asia/Tokyo");
  });

  it("falls back to the default with no provider at all", () => {
    render(<OverridableProbe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("UTC");
  });
});
