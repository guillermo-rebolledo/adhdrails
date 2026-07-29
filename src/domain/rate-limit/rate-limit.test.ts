import { describe, expect, it } from "vitest";

import { evaluateRateLimit, type RateLimitRule } from "./rate-limit";

const rule: RateLimitRule = { limit: 3, windowMs: 60_000 };

describe("fixed-window rate limit", () => {
  it("opens a fresh window on the first request", () => {
    const result = evaluateRateLimit(null, rule, 1_000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.retryAfterMs).toBe(0);
    expect(result.state).toEqual({ count: 1, windowStartedAt: 1_000 });
  });

  it("counts requests within the same window", () => {
    let state = evaluateRateLimit(null, rule, 1_000).state;
    state = evaluateRateLimit(state, rule, 1_500).state;
    const third = evaluateRateLimit(state, rule, 1_800);

    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("blocks once the limit is exceeded and reports when to retry", () => {
    let state = evaluateRateLimit(null, rule, 1_000).state;
    state = evaluateRateLimit(state, rule, 1_100).state;
    state = evaluateRateLimit(state, rule, 1_200).state;
    const blocked = evaluateRateLimit(state, rule, 1_300);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    // Window opened at 1_000 and runs 60s, so retry after the remaining 59.7s.
    expect(blocked.retryAfterMs).toBe(59_700);
  });

  it("starts a new window once the previous one elapses", () => {
    let state = evaluateRateLimit(null, rule, 1_000).state;
    state = evaluateRateLimit(state, rule, 1_100).state;
    state = evaluateRateLimit(state, rule, 1_200).state;

    const afterWindow = evaluateRateLimit(state, rule, 61_001);

    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.remaining).toBe(2);
    expect(afterWindow.state).toEqual({ count: 1, windowStartedAt: 61_001 });
  });
});
