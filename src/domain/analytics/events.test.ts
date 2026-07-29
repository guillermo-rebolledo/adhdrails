import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENT_NAMES,
  UMAMI_ENDPOINT_HOST,
  UMAMI_REGION,
  buildAnalyticsEvent,
  isApprovedAnalyticsEvent,
} from "./events";

describe("analytics events", () => {
  it("hosts analytics in the US region with no session replay concept", () => {
    expect(UMAMI_REGION).toBe("us");
    expect(UMAMI_ENDPOINT_HOST).toBe("https://us.umami.is");
  });

  it("accepts an approved content-free event and returns only allowlisted data", () => {
    const event = buildAnalyticsEvent({
      name: "inbox_item_classified",
      classifiedAs: "task",
    });

    expect(event).toEqual({
      name: "inbox_item_classified",
      data: { classifiedAs: "task" },
    });
  });

  it("accepts a bare event with no properties", () => {
    expect(buildAnalyticsEvent({ name: "focus_session_started" })).toEqual({
      name: "focus_session_started",
      data: {},
    });
  });

  it("rejects an event name that is not on the allowlist", () => {
    // @ts-expect-error — deliberately off the allowlist
    expect(buildAnalyticsEvent({ name: "task_title_typed" })).toBeNull();
    expect(isApprovedAnalyticsEvent("task_title_typed")).toBe(false);
    expect(isApprovedAnalyticsEvent("task_created")).toBe(true);
  });

  it("rejects an approved event carrying an unapproved (potentially sensitive) property", () => {
    // A stray free-text field must never ride along into analytics.
    expect(
      buildAnalyticsEvent({
        name: "task_created",
        // @ts-expect-error — titles must never reach analytics
        title: "Call the pharmacy about my prescription",
      }),
    ).toBeNull();
    expect(
      // @ts-expect-error — search text must never reach analytics
      buildAnalyticsEvent({ name: "search_performed", query: "therapist" }),
    ).toBeNull();
    expect(
      // @ts-expect-error — URLs must never reach analytics
      buildAnalyticsEvent({ name: "calendar_connected", url: "https://x" }),
    ).toBeNull();
  });

  it("rejects an approved property carrying an out-of-range value", () => {
    expect(
      buildAnalyticsEvent({
        name: "inbox_item_classified",
        // @ts-expect-error — not a valid item type
        classifiedAs: "note",
      }),
    ).toBeNull();
    expect(
      // @ts-expect-error — not a valid energy value
      buildAnalyticsEvent({ name: "task_created", energy: "extreme" }),
    ).toBeNull();
  });

  it("keeps the allowlist free of any content-bearing property names", () => {
    const forbidden = [
      "title",
      "notes",
      "body",
      "content",
      "description",
      "query",
      "text",
      "url",
      "token",
      "email",
      "endpoint",
    ];
    for (const name of ANALYTICS_EVENT_NAMES) {
      const event = buildAnalyticsEvent({ name });
      expect(event).not.toBeNull();
      for (const key of Object.keys(event?.data ?? {})) {
        expect(forbidden).not.toContain(key);
      }
    }
  });
});
