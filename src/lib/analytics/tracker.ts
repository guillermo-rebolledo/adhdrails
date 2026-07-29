import {
  type AnalyticsEvent,
  type AnalyticsEventInput,
  buildAnalyticsEvent,
} from "@/domain/analytics/events";

/**
 * The single sink an analytics event is handed to once it has been validated.
 * In the browser this forwards to Umami's `track`; in tests it is a spy.
 */
export type AnalyticsSink = (event: AnalyticsEvent) => void;

export interface AnalyticsTracker {
  track: (input: AnalyticsEventInput) => void;
}

/**
 * Wraps a sink so every event passes through the content-free allowlist before
 * it can be sent. An unknown name or an unexpected property is dropped silently
 * rather than forwarded, so a mistaken call site can never leak content into
 * analytics. This is the only path the app should use to emit an event.
 */
export function createAnalyticsTracker(sink: AnalyticsSink): AnalyticsTracker {
  return {
    track(input) {
      const event = buildAnalyticsEvent(input);
      if (event) {
        sink(event);
      }
    },
  };
}

/** A tracker that discards every event, used when analytics is not configured. */
export const noopAnalyticsTracker: AnalyticsTracker = {
  track: () => undefined,
};
