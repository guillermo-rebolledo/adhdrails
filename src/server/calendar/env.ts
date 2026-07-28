import { createHash } from "node:crypto";

import type { TokenKeyring } from "./token-cipher";

/**
 * A deterministic development/test key. Real environments supply base64 keys
 * through `CALENDAR_TOKEN_KEY_V<n>`; this fallback lets the server boot and the
 * test suite run without provisioning secrets, and is never used in production.
 */
const DEVELOPMENT_KEY_SEED = "rails-development-only-calendar-token-key";

function developmentKey(version: number): Buffer {
  return createHash("sha256")
    .update(`${DEVELOPMENT_KEY_SEED}:${version}`)
    .digest();
}

function isProductionRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/**
 * Collects the AES-256 keys visible to this process. A key for version `n` is
 * read from `CALENDAR_TOKEN_KEY_V<n>` (base64, 32 bytes). The current version
 * comes from `CALENDAR_TOKEN_KEY_VERSION` (default 1). Production requires a
 * real key for the current version; local and test runtimes derive a
 * deterministic development key so previously encrypted values remain readable.
 */
export function readCalendarTokenKeyring(
  env: NodeJS.ProcessEnv = process.env,
): TokenKeyring {
  const currentVersion = Number.parseInt(
    env.CALENDAR_TOKEN_KEY_VERSION ?? "1",
    10,
  );

  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new Error("CALENDAR_TOKEN_KEY_VERSION must be a positive integer.");
  }

  const keys = new Map<number, Buffer>();
  const prefix = "CALENDAR_TOKEN_KEY_V";

  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(prefix) || !value) {
      continue;
    }
    const version = Number.parseInt(name.slice(prefix.length), 10);
    if (!Number.isInteger(version) || version < 1) {
      continue;
    }
    const key = Buffer.from(value, "base64");
    if (key.byteLength !== 32) {
      throw new Error(`${name} must decode to a 32-byte base64 key.`);
    }
    keys.set(version, key);
  }

  if (!keys.has(currentVersion)) {
    if (isProductionRuntime(env)) {
      throw new Error(
        `CALENDAR_TOKEN_KEY_V${currentVersion} is required in production.`,
      );
    }
    keys.set(currentVersion, developmentKey(currentVersion));
  }

  return { currentVersion, keys };
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const DEVELOPMENT_GOOGLE_PLACEHOLDER = "rails-development-google-placeholder";

function baseUrl(env: NodeJS.ProcessEnv): string {
  return (
    env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  );
}

/**
 * OAuth client configuration for the incremental Calendar authorization flow.
 * It reuses the same Google client as identity sign-in but redirects to the
 * Calendar callback. Production requires real credentials; other runtimes fall
 * back to placeholders so the server can boot (a real grant still needs them).
 */
export function readGoogleOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleOAuthConfig {
  const production = isProductionRuntime(env);

  function required(value: string | undefined, name: string): string {
    if (value && value.trim() !== "") {
      return value;
    }
    if (production) {
      throw new Error(`${name} is required in production.`);
    }
    return DEVELOPMENT_GOOGLE_PLACEHOLDER;
  }

  return {
    clientId: required(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
    clientSecret: required(env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET"),
    redirectUri: `${baseUrl(env).replace(/\/$/, "")}/api/calendar/callback`,
  };
}
