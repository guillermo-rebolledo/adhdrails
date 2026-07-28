/**
 * CSRF protection and return-path handling for the incremental Calendar OAuth
 * redirect flow. The authorization request stamps a random state into an
 * HttpOnly cookie and the Google `state` parameter; the callback accepts the
 * grant only when the two match (double-submit). Pure string/cookie helpers so
 * the route handlers stay thin and testable.
 */
export const STATE_COOKIE = "rails_calendar_oauth_state";
export const RETURN_COOKIE = "rails_calendar_oauth_return";

const STATE_MAX_AGE_SECONDS = 600;

export function createOAuthState(): string {
  return crypto.randomUUID();
}

/** Parses a `Cookie` header into a name→value map (values URL-decoded). */
export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) {
    return cookies;
  }
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      cookies.set(name, decodeURIComponent(value));
    }
  }
  return cookies;
}

/**
 * A safe in-app return path: it must be a root-relative path and must not be
 * protocol-relative (`//host`), so the redirect can never leave the app.
 */
export function safeReturnPath(
  candidate: string | null,
  fallback = "/settings",
): string {
  if (candidate && candidate.startsWith("/") && !candidate.startsWith("//")) {
    return candidate;
  }
  return fallback;
}

interface CookieOptions {
  secure: boolean;
}

function serializeCookie(
  name: string,
  value: string,
  maxAge: number,
  { secure }: CookieOptions,
): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function setStateCookies(
  headers: Headers,
  state: string,
  returnPath: string,
  options: CookieOptions,
): void {
  headers.append(
    "set-cookie",
    serializeCookie(STATE_COOKIE, state, STATE_MAX_AGE_SECONDS, options),
  );
  headers.append(
    "set-cookie",
    serializeCookie(RETURN_COOKIE, returnPath, STATE_MAX_AGE_SECONDS, options),
  );
}

export function clearStateCookies(
  headers: Headers,
  options: CookieOptions,
): void {
  headers.append("set-cookie", serializeCookie(STATE_COOKIE, "", 0, options));
  headers.append("set-cookie", serializeCookie(RETURN_COOKIE, "", 0, options));
}
