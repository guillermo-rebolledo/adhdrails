import { afterEach, describe, expect, it, vi } from "vitest";

import { correlationIdFrom } from "./correlation-id";

describe("correlation IDs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps an opaque UUID supplied by trusted infrastructure", () => {
    const request = new Request("https://rails.example", {
      headers: {
        "x-correlation-id": "00000000-0000-4000-8000-000000000001",
      },
    });

    expect(correlationIdFrom(request)).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it.each([
    "customer@example.com",
    "123-45-6789",
    "customer_name",
    "contains spaces",
    "x".repeat(129),
    "<script>alert(1)</script>",
  ])("replaces unsafe caller-controlled content: %s", (incomingId) => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000002",
    );
    const request = new Request("https://rails.example", {
      headers: { "x-correlation-id": incomingId },
    });

    expect(correlationIdFrom(request)).toBe(
      "00000000-0000-4000-8000-000000000002",
    );
  });
});
