"use client";

import { useEffect, useState } from "react";

import {
  REMINDER_LEAD_MINUTES,
  type ReminderPreferences,
} from "@/domain/notification/reminder";
import { Button } from "@/components/ui/button";

interface NotificationSettingsProps {
  initialPreferences: ReminderPreferences;
  vapidPublicKey: string | null;
}

type Capability =
  | { kind: "checking" }
  | { kind: "unsupported" }
  | { kind: "supported"; permission: NotificationPermission };

const SUBSCRIPTION_ID_KEY = "rails.push-subscription-id";

function supportsWebPush(vapidPublicKey: string | null): boolean {
  return Boolean(
    vapidPublicKey &&
    window.Notification &&
    navigator.serviceWorker &&
    window.PushManager,
  );
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const bytes = Uint8Array.from(atob(base64), (character) =>
    character.charCodeAt(0),
  );
  return new Uint8Array(bytes.buffer);
}

function deviceSubscriptionId(): string {
  const existing = localStorage.getItem(SUBSCRIPTION_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(SUBSCRIPTION_ID_KEY, created);
  return created;
}

export function NotificationSettings({
  initialPreferences,
  vapidPublicKey,
}: NotificationSettingsProps) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [capability, setCapability] = useState<Capability>({
    kind: "checking",
  });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (!supportsWebPush(vapidPublicKey)) {
        setCapability({ kind: "unsupported" });
        return;
      }
      setCapability({
        kind: "supported",
        permission: window.Notification.permission,
      });
      setSubscriptionId(localStorage.getItem(SUBSCRIPTION_ID_KEY));
    });
    return () => {
      active = false;
    };
  }, [vapidPublicKey]);

  async function save(next: ReminderPreferences) {
    setPreferences(next);
    try {
      const response = await fetch("/api/v1/notifications/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("save failed");
      setStatus("Reminder settings saved.");
    } catch {
      setStatus(
        "We couldn't save while offline. In-app cues will stay available.",
      );
    }
  }

  async function subscribe(): Promise<string> {
    if (!vapidPublicKey) throw new Error("Web Push is not configured.");
    const registration =
      await navigator.serviceWorker.register("/serwist/sw.js");
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(vapidPublicKey),
      }));
    const json = subscription.toJSON();
    const id = deviceSubscriptionId();
    const response = await fetch("/api/v1/notifications/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: json.keys,
      }),
    });
    if (!response.ok) throw new Error("subscription failed");
    const saved = (await response.json()) as { id?: unknown };
    if (typeof saved.id !== "string") throw new Error("subscription failed");
    localStorage.setItem(SUBSCRIPTION_ID_KEY, saved.id);
    setSubscriptionId(saved.id);
    return saved.id;
  }

  async function enableBrowserReminders() {
    setBusy(true);
    setStatus(null);
    try {
      const permission = await window.Notification.requestPermission();
      setCapability({ kind: "supported", permission });
      if (permission !== "granted") {
        setStatus(
          "Browser permission wasn't granted. In-app cues will stay on.",
        );
        return;
      }
      await subscribe();
      await save({ ...preferences, enabled: true });
    } catch {
      setStatus(
        "Browser reminders couldn't be enabled. In-app cues will stay on.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function setMasterEnabled(enabled: boolean) {
    setBusy(true);
    try {
      if (enabled && !subscriptionId) await subscribe();
      await save({ ...preferences, enabled });
    } catch {
      setStatus(
        "Browser reminders couldn't be updated. In-app cues will stay on.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addThisBrowser() {
    setBusy(true);
    try {
      await subscribe();
      setStatus("This browser is ready for Task reminders.");
    } catch {
      setStatus("This browser couldn't be subscribed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function removeThisBrowser() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
      if (subscriptionId) {
        await fetch("/api/v1/notifications/subscriptions", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: subscriptionId }),
        });
      }
      localStorage.removeItem(SUBSCRIPTION_ID_KEY);
      setSubscriptionId(null);
      setStatus("This browser will no longer receive Task reminders.");
    } catch {
      setStatus("We couldn't update this device. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!subscriptionId) return;
    setBusy(true);
    try {
      const response = await fetch("/api/v1/notifications/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
      });
      setStatus(
        response.ok
          ? "Test notification sent to this browser."
          : "The test notification couldn't be sent.",
      );
    } catch {
      setStatus("The test notification couldn't be sent while offline.");
    } finally {
      setBusy(false);
    }
  }

  const permission =
    capability.kind === "supported" ? capability.permission : null;

  return (
    <section
      aria-labelledby="notification-settings-title"
      className="rounded-xl border bg-card p-6 text-card-foreground"
    >
      <h2 id="notification-settings-title" className="text-lg font-medium">
        Notifications
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Rails can remind this browser about timed Tasks. Google Calendar keeps
        ownership of Event notifications.
      </p>

      {capability.kind === "unsupported" ? (
        <p className="mt-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          Browser reminders aren&apos;t available here. In-app cues still work.
        </p>
      ) : null}

      {capability.kind === "supported" && permission === "default" ? (
        <div className="mt-4">
          <Button
            disabled={busy}
            onClick={enableBrowserReminders}
            type="button"
          >
            Turn on browser reminders
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Your browser will ask for permission next.
          </p>
        </div>
      ) : null}

      {capability.kind === "supported" && permission === "denied" ? (
        <p className="mt-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          Browser permission is off. In-app cues will stay on; you can change
          permission in your browser settings.
        </p>
      ) : null}

      {permission === "granted" ? (
        <fieldset className="mt-5 flex flex-col gap-4">
          <legend className="sr-only">Timed Task browser reminders</legend>
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              checked={preferences.enabled}
              className="size-4"
              disabled={busy}
              onChange={(event) => void setMasterEnabled(event.target.checked)}
              type="checkbox"
            />
            Browser reminders
          </label>

          {preferences.enabled ? (
            <>
              <label className="flex items-center gap-3 text-sm">
                <input
                  checked={preferences.headsUpEnabled}
                  className="size-4"
                  onChange={(event) =>
                    void save({
                      ...preferences,
                      headsUpEnabled: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Heads-up reminder
              </label>
              <label className="flex items-center gap-3 text-sm">
                Lead time
                <select
                  aria-label="Heads-up lead time"
                  className="rounded-md border bg-background px-2 py-1"
                  disabled={!preferences.headsUpEnabled}
                  onChange={(event) =>
                    void save({
                      ...preferences,
                      leadMinutes: Number(
                        event.target.value,
                      ) as ReminderPreferences["leadMinutes"],
                    })
                  }
                  value={preferences.leadMinutes}
                >
                  {REMINDER_LEAD_MINUTES.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  checked={preferences.atTimeEnabled}
                  className="size-4"
                  onChange={(event) =>
                    void save({
                      ...preferences,
                      atTimeEnabled: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                At-time reminder
              </label>
            </>
          ) : null}

          <Button
            disabled={busy || !subscriptionId}
            onClick={sendTest}
            type="button"
            variant="outline"
          >
            Send test notification
          </Button>

          {subscriptionId ? (
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <span className="text-sm text-muted-foreground">
                This browser is subscribed.
              </span>
              <Button
                disabled={busy}
                onClick={removeThisBrowser}
                type="button"
                variant="ghost"
              >
                Remove this browser
              </Button>
            </div>
          ) : (
            <Button
              disabled={busy}
              onClick={addThisBrowser}
              type="button"
              variant="outline"
            >
              Add this browser
            </Button>
          )}
        </fieldset>
      ) : null}

      <label className="mt-5 flex items-center gap-3 text-sm">
        <input
          checked={preferences.eventCueEnabled}
          className="size-4"
          onChange={(event) =>
            void save({
              ...preferences,
              eventCueEnabled: event.target.checked,
            })
          }
          type="checkbox"
        />
        In-app Event cue 15 minutes before
      </label>

      {status ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
