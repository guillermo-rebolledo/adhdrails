import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

describe("request security boundary", () => {
  it("adds a nonce-based policy and preserves a trusted correlation ID", () => {
    const request = new NextRequest("https://rails.example/today", {
      headers: {
        "x-correlation-id": "00000000-0000-4000-8000-000000000001",
      },
    });

    const response = proxy(request);
    const policy = response.headers.get("content-security-policy");

    expect(response.headers.get("x-correlation-id")).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(policy).toContain("default-src 'self'");
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(policy).toContain("https://cloud.umami.is");
    expect(policy).not.toContain("https://us.umami.is");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("upgrade-insecure-requests");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });
});
