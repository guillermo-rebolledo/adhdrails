import { describe, expect, it, vi } from "vitest";

import { createAnalyticsTracker } from "./tracker";

describe("analytics tracker", () => {
  it("forwards an approved, content-free event to the sink", () => {
    const sink = vi.fn();
    createAnalyticsTracker(sink).track({
      name: "task_created",
      important: true,
    });

    expect(sink).toHaveBeenCalledWith({
      name: "task_created",
      data: { important: true },
    });
  });

  it("drops an unknown event without touching the sink", () => {
    const sink = vi.fn();
    createAnalyticsTracker(sink).track({
      // @ts-expect-error — deliberately off the allowlist
      name: "keystroke_logged",
    });

    expect(sink).not.toHaveBeenCalled();
  });

  it("drops an approved event that smuggles in a content property", () => {
    const sink = vi.fn();
    createAnalyticsTracker(sink).track({
      name: "search_performed",
      // @ts-expect-error — query text must never reach analytics
      query: "medication side effects",
    });

    expect(sink).not.toHaveBeenCalled();
  });
});
