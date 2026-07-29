"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  type ConnectionResponse,
  type SelectedCalendar,
  isWritableRole,
} from "@/domain/calendar/connection";
import { problemDetail } from "@/domain/http/problem";
import { apiRequest } from "@/lib/api-client";
import { Button, buttonVariants } from "@/components/ui/button";

import { SETTINGS_SECTION_CLASS_NAME } from "./settings-section";

interface CalendarSettingsProps {
  connection: ConnectionResponse | null;
  accountTimezone: string;
  accountLocale: string;
}

const AUTHORIZE_HREF = "/api/calendar/authorize?return=/settings";

const NONE_WRITABLE = "__none__";

/** A calm status cue reflecting the outcome of a just-finished consent flow. */
function statusMessage(outcome: string | null): string | null {
  switch (outcome) {
    case "connected":
      return "Google Calendar connected.";
    case "denied":
      return "No problem — Rails works fully without Calendar access. You can connect anytime.";
    case "error":
      return "We couldn't finish connecting Google Calendar. Please try again.";
    default:
      return null;
  }
}

export function CalendarSettings({
  connection,
  accountTimezone,
  accountLocale,
}: CalendarSettingsProps) {
  const outcome = useSearchParams().get("calendar");

  return (
    <section
      aria-labelledby="calendar-settings-title"
      className={SETTINGS_SECTION_CLASS_NAME}
      id="calendars"
    >
      <h2 id="calendar-settings-title" className="text-lg font-medium">
        Calendars
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Google Calendar is optional and connected separately from sign-in. Rails
        works fully without it.
      </p>

      {statusMessage(outcome) ? (
        <p
          className="mt-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
          role="status"
        >
          {statusMessage(outcome)}
        </p>
      ) : null}

      {connection ? (
        <ConnectedCalendar
          connection={connection}
          accountTimezone={accountTimezone}
          accountLocale={accountLocale}
        />
      ) : (
        <div className="mt-6">
          <a
            className={buttonVariants()}
            href={AUTHORIZE_HREF}
            data-testid="connect-calendar"
          >
            Connect Google Calendar
          </a>
        </div>
      )}
    </section>
  );
}

function ConnectedCalendar({
  connection,
  accountTimezone,
  accountLocale,
}: {
  connection: ConnectionResponse;
  accountTimezone: string;
  accountLocale: string;
}) {
  const router = useRouter();
  const [calendars, setCalendars] = useState<SelectedCalendar[]>(
    connection.calendars,
  );
  const [save, setSave] = useState<
    "idle" | "saving" | "saved" | { error: string }
  >("idle");
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const writableId =
    calendars.find((c) => c.isWritable)?.googleCalendarId ?? NONE_WRITABLE;

  function setVisible(googleCalendarId: string, isVisible: boolean) {
    setCalendars((current) =>
      current.map((c) =>
        c.googleCalendarId === googleCalendarId ? { ...c, isVisible } : c,
      ),
    );
  }

  function setWritable(googleCalendarId: string) {
    setCalendars((current) =>
      current.map((c) => ({
        ...c,
        isWritable: c.googleCalendarId === googleCalendarId,
      })),
    );
  }

  async function saveSelection() {
    setSave("saving");
    try {
      const response = await apiRequest<unknown>("/api/v1/calendar/selection", {
        method: "PUT",
        body: JSON.stringify({
          selections: calendars.map((c) => ({
            googleCalendarId: c.googleCalendarId,
            isVisible: c.isVisible,
            isWritable: c.isWritable,
          })),
        }),
      });

      if (response.ok) {
        setSave("saved");
        router.refresh();
        return;
      }

      setSave({
        error: problemDetail(
          response.body,
          "We couldn't save your calendar selection. Please try again.",
        ),
      });
    } catch {
      setSave({
        error:
          "We couldn't save while offline. Your calendar choices are still here.",
      });
    }
  }

  async function adoptPrimaryTimezone() {
    if (!connection.primaryTimeZone) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const response = await apiRequest<unknown>("/api/v1/account", {
        method: "PATCH",
        body: JSON.stringify({
          timezone: connection.primaryTimeZone,
          locale: accountLocale,
        }),
      });
      if (!response.ok) {
        setActionError(
          problemDetail(
            response.body,
            "We couldn't update your timezone. Please try again.",
          ),
        );
        return;
      }
      router.refresh();
    } catch {
      setActionError(
        "We couldn't update your timezone while offline. Please try again when connected.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setActionError(null);
    try {
      const response = await apiRequest<unknown>(
        "/api/v1/calendar/connection",
        { method: "DELETE" },
      );
      if (!response.ok) {
        setActionError(
          problemDetail(
            response.body,
            "We couldn't disconnect Google Calendar. Please try again.",
          ),
        );
        return;
      }
      router.refresh();
    } catch {
      setActionError(
        "We couldn't disconnect while offline. Please try again when connected.",
      );
    } finally {
      setBusy(false);
    }
  }

  const offerTimezone =
    connection.primaryTimeZone !== null &&
    connection.primaryTimeZone !== accountTimezone;

  return (
    <div className="mt-4 flex flex-col gap-6">
      <p className="text-sm" role="status">
        <span className="font-medium text-foreground">Connected.</span>{" "}
        <span className="text-muted-foreground">
          Choose which calendars appear in your agenda and which one receives
          new events.
        </span>
        {connection.lastSyncedAt ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            Last synced{" "}
            {new Intl.DateTimeFormat(accountLocale, {
              timeZone: accountTimezone,
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(connection.lastSyncedAt))}
          </span>
        ) : null}
      </p>

      {offerTimezone ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-3">
          <p className="text-sm text-muted-foreground">
            Your primary Google calendar uses{" "}
            <span className="font-medium text-foreground">
              {connection.primaryTimeZone}
            </span>
            . Use it as your Rails time zone?
          </p>
          <Button
            disabled={busy}
            onClick={adoptPrimaryTimezone}
            size="sm"
            type="button"
          >
            Use {connection.primaryTimeZone}
          </Button>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Calendars</legend>
        <ul className="flex flex-col divide-y rounded-lg border">
          {calendars.map((calendar) => {
            const writableAllowed = isWritableRole(calendar.accessRole);
            return (
              <li
                key={calendar.googleCalendarId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3"
              >
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <input
                    checked={calendar.isVisible}
                    className="size-4"
                    onChange={(event) =>
                      setVisible(
                        calendar.googleCalendarId,
                        event.target.checked,
                      )
                    }
                    type="checkbox"
                  />
                  <span className="font-medium">{calendar.summary}</span>
                  {calendar.primary ? (
                    <span className="text-xs text-muted-foreground">
                      Primary
                    </span>
                  ) : null}
                  {!writableAllowed ? (
                    <span className="text-xs text-muted-foreground">
                      Read-only
                    </span>
                  ) : null}
                </label>

                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    checked={calendar.isWritable}
                    disabled={!writableAllowed}
                    name="writable-calendar"
                    onChange={() => setWritable(calendar.googleCalendarId)}
                    type="radio"
                  />
                  New events here
                </label>
              </li>
            );
          })}
        </ul>
        <label className="flex items-center gap-2 px-3 text-sm text-muted-foreground">
          <input
            checked={writableId === NONE_WRITABLE}
            name="writable-calendar"
            onChange={() =>
              setCalendars((current) =>
                current.map((c) => ({ ...c, isWritable: false })),
              )
            }
            type="radio"
          />
          Don&apos;t create events in Google Calendar
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={save === "saving"}
          onClick={saveSelection}
          type="button"
        >
          {save === "saving" ? "Saving…" : "Save calendars"}
        </Button>
        {save === "saved" ? (
          <span className="text-sm text-muted-foreground" role="status">
            Saved.
          </span>
        ) : null}
      </div>

      {typeof save === "object" ? (
        <p className="text-sm text-destructive" role="alert">
          {save.error}
        </p>
      ) : null}

      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      <div className="border-t pt-4">
        {confirmingDisconnect ? (
          <div
            className="flex flex-wrap items-center gap-3"
            role="group"
            aria-label="Confirm disconnect"
          >
            <p className="text-sm text-muted-foreground">
              Disconnecting keeps your local events and account. Continue?
            </p>
            <Button
              disabled={busy}
              onClick={disconnect}
              type="button"
              variant="destructive"
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => setConfirmingDisconnect(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => setConfirmingDisconnect(true)}
            type="button"
            variant="outline"
          >
            Disconnect Google Calendar
          </Button>
        )}
      </div>
    </div>
  );
}
