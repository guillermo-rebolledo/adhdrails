import { describe, expect, it } from "vitest";

import { clientKeyFrom, createInMemoryRateLimiter } from "./limiter";

const rule = { limit: 2, windowMs: 1_000 };

describe("in-memory rate limiter", () => {
  it("keeps independent counters per key", () => {
    const limiter = createInMemoryRateLimiter();
    const at = new Date(0);

    expect(limiter.consume("a", rule, at).allowed).toBe(true);
    expect(limiter.consume("a", rule, at).allowed).toBe(true);
    expect(limiter.consume("a", rule, at).allowed).toBe(false);
    // A different key is unaffected by "a" exhausting its window.
    expect(limiter.consume("b", rule, at).allowed).toBe(true);
  });

  it("resets a key once its window elapses", () => {
    const limiter = createInMemoryRateLimiter();

    limiter.consume("a", rule, new Date(0));
    limiter.consume("a", rule, new Date(0));
    expect(limiter.consume("a", rule, new Date(500)).allowed).toBe(false);
    expect(limiter.consume("a", rule, new Date(1_001)).allowed).toBe(true);
  });

  it("derives the client key from the forwarded IP", () => {
    const request = new Request("https://rails.app", {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18" },
    });
    expect(clientKeyFrom(request)).toBe("203.0.113.7");
  });

  it("falls back to a bounded bucket when no IP is present", () => {
    expect(clientKeyFrom(new Request("https://rails.app"))).toBe("unknown");
  });
});
