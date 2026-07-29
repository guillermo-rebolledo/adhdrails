"use client";

import Script from "next/script";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { AnalyticsEvent } from "@/domain/analytics/events";
import { resolveAnalyticsConfig } from "@/lib/analytics/config";
import {
  createAnalyticsTracker,
  noopAnalyticsTracker,
  type AnalyticsTracker,
} from "@/lib/analytics/tracker";

interface UmamiGlobal {
  track: (name: string, data?: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    umami?: UmamiGlobal;
  }
}

const AnalyticsContext = createContext<AnalyticsTracker>(noopAnalyticsTracker);

/** Access the app-wide analytics tracker. Safe to call even when disabled. */
export function useAnalytics(): AnalyticsTracker {
  return useContext(AnalyticsContext);
}

/**
 * Loads Umami Cloud (US region, no session replay) and exposes the content-free
 * tracker through context. When no website id is configured the provider mounts
 * no script and hands children the no-op tracker, so local and preview builds
 * never report. The tracker forwards only allowlisted events, and the sink hands
 * Umami just the event name and its bounded data — never the page URL, referrer,
 * or any user content.
 */
export function AnalyticsProvider({
  children,
  nonce,
}: {
  children: ReactNode;
  nonce?: string;
}) {
  const config = resolveAnalyticsConfig();

  const tracker = useMemo<AnalyticsTracker>(() => {
    if (!config) {
      return noopAnalyticsTracker;
    }
    return createAnalyticsTracker((event: AnalyticsEvent) => {
      if (typeof window !== "undefined" && window.umami) {
        window.umami.track(event.name, event.data);
      }
    });
  }, [config]);

  return (
    <AnalyticsContext.Provider value={tracker}>
      {config ? (
        <Script
          src={config.scriptSrc}
          data-website-id={config.websiteId}
          data-auto-track="false"
          strategy="afterInteractive"
          nonce={nonce}
        />
      ) : null}
      {children}
    </AnalyticsContext.Provider>
  );
}
