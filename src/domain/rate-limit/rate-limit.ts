/**
 * A pure fixed-window rate-limit calculation. Rails protects its public and
 * asynchronous surfaces at the application layer without introducing Redis, so
 * the counting rule lives here as a pure function and the storage (an in-memory
 * per-instance map, or a durable per-device row) is the caller's concern. A
 * fixed window is deliberately simple: it needs only a count and the window
 * start, so any store can hold it and any test can reason about it.
 */

export interface RateLimitRule {
  /** The most requests allowed within one window. */
  limit: number;
  /** The window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitState {
  count: number;
  windowStartedAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
  state: RateLimitState;
}

/**
 * Applies one request to a window. Passing the previous state (or `null` for a
 * key seen for the first time) and the current epoch-millisecond time returns
 * the decision and the state to persist. When the stored window has elapsed a
 * fresh window opens, so state never has to be pruned for correctness — only to
 * reclaim memory.
 */
export function evaluateRateLimit(
  previous: RateLimitState | null,
  rule: RateLimitRule,
  nowMs: number,
): RateLimitDecision {
  const inWindow =
    previous !== null && nowMs < previous.windowStartedAt + rule.windowMs;

  const state: RateLimitState = inWindow
    ? { count: previous.count + 1, windowStartedAt: previous.windowStartedAt }
    : { count: 1, windowStartedAt: nowMs };

  const allowed = state.count <= rule.limit;
  const remaining = Math.max(0, rule.limit - state.count);
  const retryAfterMs = allowed
    ? 0
    : state.windowStartedAt + rule.windowMs - nowMs;

  return { allowed, remaining, retryAfterMs, limit: rule.limit, state };
}
