import {
  evaluateRateLimit,
  type RateLimitDecision,
  type RateLimitRule,
  type RateLimitState,
} from "@/domain/rate-limit/rate-limit";

/**
 * Named rate-limit rules for Rails' protected surfaces. These bound abuse of the
 * public and expensive endpoints at the application layer without Redis; the
 * store is an in-memory map per serverless instance, so the effective ceiling is
 * per-instance, which is the intended MVP protection rather than a global quota.
 */
export const RATE_LIMIT_RULES = {
  // Google re-delivers push notifications; this bounds a misbehaving or spoofed
  // channel while comfortably clearing normal Calendar traffic.
  calendarWebhook: { limit: 60, windowMs: 60_000 },
  // Sending a test push is user-triggered and hits the push provider, so it is
  // held to a handful per minute per account.
  notificationTest: { limit: 5, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimiter {
  /** Applies one request for `key` under `rule` and returns the decision. */
  consume: (key: string, rule: RateLimitRule, now?: Date) => RateLimitDecision;
}

/**
 * An in-memory fixed-window limiter. State lives in a `Map` scoped to the
 * process, so it is per-instance by construction — appropriate for MVP
 * application-layer protection without Redis. Expired windows are pruned lazily
 * as keys are touched and, as a backstop, whenever the map grows past a soft cap,
 * so memory stays bounded under churn.
 */
export function createInMemoryRateLimiter(): RateLimiter {
  const states = new Map<string, RateLimitState>();
  const PRUNE_THRESHOLD = 10_000;

  function prune(nowMs: number, maxWindowMs: number) {
    for (const [key, state] of states) {
      if (nowMs >= state.windowStartedAt + maxWindowMs) {
        states.delete(key);
      }
    }
  }

  return {
    consume(key, rule, now = new Date()) {
      const nowMs = now.getTime();

      if (states.size > PRUNE_THRESHOLD) {
        prune(nowMs, rule.windowMs);
      }

      const decision = evaluateRateLimit(states.get(key) ?? null, rule, nowMs);
      states.set(key, decision.state);
      return decision;
    },
  };
}

/**
 * The process-wide limiter. Route handlers share one instance so counts persist
 * across requests served by the same instance.
 */
export const rateLimiter = createInMemoryRateLimiter();

/**
 * Derives a stable, non-identifying limiter key from a request. Prefers the
 * client IP forwarded by Vercel's edge; falls back to a constant bucket so an
 * IP-less request is still bounded rather than exempt. The caller namespaces the
 * key by surface so unrelated endpoints never share a counter.
 */
export function clientKeyFrom(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return ip && ip.length > 0 ? ip : "unknown";
}
