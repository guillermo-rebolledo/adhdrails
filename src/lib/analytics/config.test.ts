import { describe, expect, it } from "vitest";

import { resolveAnalyticsConfig } from "./config";

describe("analytics config", () => {
  it("is disabled when no website id is set", () => {
    expect(resolveAnalyticsConfig({})).toBeNull();
    expect(
      resolveAnalyticsConfig({ NEXT_PUBLIC_UMAMI_WEBSITE_ID: "  " }),
    ).toBeNull();
  });

  it("pins the tracker script to the US Umami host and is not overridable", () => {
    const config = resolveAnalyticsConfig({
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: "abc-123",
    });

    expect(config).toEqual({
      websiteId: "abc-123",
      scriptSrc: "https://us.umami.is/script.js",
    });
  });
});
