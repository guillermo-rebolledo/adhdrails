import { getDatabase } from "@/server/db/connection";

import { type Auth, createAuth, readAuthEnvironment } from "./config";

let cached: Auth | null = null;
let cachedTest: Auth | null = null;

/**
 * The process-wide Better Auth instance, built lazily so importing this module
 * never requires database or credential access at module load.
 */
export function getAuth(): Auth {
  if (!cached) {
    cached = createAuth(getDatabase(), readAuthEnvironment());
  }

  return cached;
}

/**
 * A companion instance with test-only email/password enabled, used exclusively
 * by the test session bootstrap. It shares the same secret and database as
 * {@link getAuth}, so sessions it creates are accepted by the real instance.
 * Never call this outside the `test` runtime.
 */
export function getTestAuth(): Auth {
  if (!cachedTest) {
    cachedTest = createAuth(getDatabase(), readAuthEnvironment(), {
      enableTestCredentials: true,
    });
  }

  return cachedTest;
}
