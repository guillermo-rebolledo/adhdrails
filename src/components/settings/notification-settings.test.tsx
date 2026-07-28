// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_REMINDER_PREFERENCES } from "@/domain/notification/reminder";

import { NotificationSettings } from "./notification-settings";

const fetchMock = vi.fn();

describe("NotificationSettings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  it("hides permission-dependent controls when Web Push is unsupported", async () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });

    render(
      <NotificationSettings
        initialPreferences={DEFAULT_REMINDER_PREFERENCES}
        vapidPublicKey={null}
      />,
    );

    expect(
      await screen.findByText(/browser reminders aren't available/i),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /turn on browser reminders/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /in-app event cue/i }),
    ).toBeVisible();
  });

  it("requests permission only after the contextual enable action", async () => {
    const user = userEvent.setup();
    const requestPermission = vi.fn().mockResolvedValue("denied");
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "default", requestPermission },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class {},
    });

    render(
      <NotificationSettings
        initialPreferences={DEFAULT_REMINDER_PREFERENCES}
        vapidPublicKey="public-key"
      />,
    );

    expect(requestPermission).not.toHaveBeenCalled();
    await user.click(
      await screen.findByRole("button", {
        name: /turn on browser reminders/i,
      }),
    );

    await waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());
    expect(await screen.findByRole("status")).toHaveTextContent(
      /in-app cues will stay on/i,
    );
  });

  it("keeps an in-app fallback when saving fails offline", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "denied", requestPermission: vi.fn() },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class {},
    });
    fetchMock.mockRejectedValue(new TypeError("offline"));

    render(
      <NotificationSettings
        initialPreferences={DEFAULT_REMINDER_PREFERENCES}
        vapidPublicKey="public-key"
      />,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: /in-app event cue/i }),
    );

    expect(
      await screen.findByText(/couldn't save while offline/i),
    ).toBeVisible();
  });
});
