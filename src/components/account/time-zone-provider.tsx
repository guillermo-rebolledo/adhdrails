"use client";

import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import {
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  resolveEffectiveTimeZone,
  timeZoneNeedsCapture,
} from "@/domain/account/onboarding";

// The browser's zone is client-only data. Reading it through
// useSyncExternalStore keeps the server render and the first client render in
// agreement (no hydration mismatch) while still refining the value once
// mounted — the same approach onboarding uses to detect a zone in the first
// place.
const noopSubscribe = () => () => {};

function detectTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface TimeZoneContextValue {
  /** The zone every clock time in the app is rendered in. */
  timeZone: string;
  /** The formatting locale that accompanies it. */
  locale: string;
}

const TimeZoneContext = createContext<TimeZoneContextValue | null>(null);

/**
 * Supplies the whole app with one time zone.
 *
 * Two jobs. First, it *resolves* the zone to render in: the account's stored
 * zone when it is known, the browser's when it is not. Because every screen
 * reads from here rather than threading its own value down from the server, no
 * two screens can show the same instant at different hours.
 *
 * Second, when the account has no zone, it *captures* the browser's into the
 * account. This is the part a display-only fix cannot do: reminders and
 * scheduling run on the server, where there is no browser to ask, so an account
 * whose zone is never recorded keeps firing notifications at the wrong hour no
 * matter how well the interface compensates. The capture endpoint only ever
 * fills in an unknown zone, so this can never overwrite a user's choice from
 * Settings.
 */
export function TimeZoneProvider({
  accountTimeZone,
  locale,
  children,
}: {
  accountTimeZone: string | null;
  locale: string;
  children: ReactNode;
}) {
  const detected = useSyncExternalStore(
    noopSubscribe,
    detectTimeZone,
    () => accountTimeZone ?? undefined,
  );

  const timeZone = resolveEffectiveTimeZone(accountTimeZone, detected);
  const settled = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (settled.current || !timeZoneNeedsCapture(accountTimeZone)) {
      return;
    }
    if (timeZoneNeedsCapture(detected)) {
      return;
    }

    let cancelled = false;

    async function capture() {
      if (inFlight.current || settled.current) {
        return;
      }
      inFlight.current = true;

      try {
        const response = await fetch("/api/v1/account/timezone", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ timezone: detected }),
        });

        // Anything the server has an opinion about is final: it either recorded
        // the zone, already had one, or rejected this one. Only a lost
        // connection or a server fault leaves the question genuinely open.
        if (!cancelled && response.status < 500) {
          settled.current = true;
        }
      } catch {
        // Left unsettled on purpose, so the `online` listener below retries.
      } finally {
        inFlight.current = false;
      }
    }

    // Rails is offline-first, so the very first load of a new account may well
    // have no connection — the case this capture matters most in, since an
    // account whose zone is never recorded keeps scheduling reminders on the
    // UTC fallback. Retrying when the connection returns follows the outbox:
    // attempt now, attempt again on `online`, and never more than one at a
    // time. The server's IS NULL guard makes a redundant attempt harmless.
    void capture();
    window.addEventListener("online", capture);

    return () => {
      cancelled = true;
      window.removeEventListener("online", capture);
    };
  }, [accountTimeZone, detected]);

  return (
    <TimeZoneContext.Provider value={{ timeZone, locale }}>
      {children}
    </TimeZoneContext.Provider>
  );
}

/**
 * The zone and locale to render clock times in. Every client surface that shows
 * a time uses this rather than accepting a zone from the server, so the app
 * speaks with one clock.
 */
export function useTimeZone(): TimeZoneContextValue {
  const value = useContext(TimeZoneContext);

  if (!value) {
    throw new Error("useTimeZone must be used within a TimeZoneProvider.");
  }

  return value;
}

/**
 * The app clock, for components that also accept an explicit zone or locale.
 *
 * In the app nothing overrides the provider — screens deliberately stopped
 * threading a zone down from their server page, which is what let surfaces
 * drift apart. The overrides remain so a component can still be rendered on its
 * own in a test or a harness, and the static defaults are the last resort for
 * that case alone.
 */
export function useClock(
  overrides: { timeZone?: string; locale?: string } = {},
): TimeZoneContextValue {
  const context = useContext(TimeZoneContext);

  return {
    timeZone: overrides.timeZone ?? context?.timeZone ?? DEFAULT_TIMEZONE,
    locale: overrides.locale ?? context?.locale ?? DEFAULT_LOCALE,
  };
}
