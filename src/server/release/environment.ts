/**
 * Release environment verification.
 *
 * Release scripts run from a developer machine after pulling the target
 * environment's variables. Before any mutation (migrations, restore points,
 * deploys) these guards confirm the loaded environment actually belongs to the
 * intended tier and that the isolated per-environment configuration is present.
 * A mismatch fails closed so a production release can never run against a
 * staging (or stale local) configuration by accident.
 *
 * Every failure names the offending variable but never echoes its value, so the
 * scripts stay safe to run in shared or recorded terminals.
 */

export type ReleaseTarget = "staging" | "production";

export const RELEASE_TARGETS: readonly ReleaseTarget[] = [
  "staging",
  "production",
];

type ReleaseEnvironment = Record<string, string | undefined>;

interface AssertReleaseEnvironmentOptions {
  target: ReleaseTarget;
  environment: ReleaseEnvironment;
}

export interface ReleaseEnvironmentSummary {
  target: ReleaseTarget;
  /** Host of the public app URL — safe to log. */
  appHost: string;
  /** Host (and port) of the database — never includes credentials. */
  databaseHost: string;
}

/**
 * Variables every deployed environment must isolate. The values differ per
 * environment; here we only prove each one is present and non-empty so a deploy
 * cannot proceed with a half-configured tier.
 */
const REQUIRED_ISOLATED_KEYS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "NEXT_PUBLIC_APP_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "CALENDAR_TOKEN_KEY_VERSION",
  "CALENDAR_TOKEN_KEY_V1",
  "VAPID_SUBJECT",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
] as const;

/**
 * Additional variables that production cannot ship without: the audit pseudonym
 * secret (the app throws on boot without it) and the Neon credentials the
 * restore-point and retention checks depend on.
 */
const PRODUCTION_ONLY_KEYS = [
  "OPERATIONAL_AUDIT_PSEUDONYM_SECRET",
  "NEON_API_KEY",
  "NEON_PROJECT_ID",
  "NEON_BRANCH_ID",
] as const;

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function hostOf(value: string, name: string): string {
  try {
    return new URL(value).host;
  } catch {
    throw new Error(`${name} is not a valid URL.`);
  }
}

/**
 * Verifies the loaded environment matches `target` and carries a complete,
 * isolated configuration. Returns non-secret facts the caller may safely log.
 * Throws — without echoing any secret value — on the first problem found.
 */
export function assertReleaseEnvironment({
  target,
  environment,
}: AssertReleaseEnvironmentOptions): ReleaseEnvironmentSummary {
  const appEnv = environment.APP_ENV;

  if (!present(appEnv)) {
    throw new Error(
      `Refusing to release to ${target}: APP_ENV is not set on the loaded environment.`,
    );
  }

  if (appEnv !== target) {
    throw new Error(
      `Refusing to release to ${target}: the loaded environment is APP_ENV="${appEnv}".`,
    );
  }

  const requiredKeys = [
    ...REQUIRED_ISOLATED_KEYS,
    ...(target === "production" ? PRODUCTION_ONLY_KEYS : []),
  ];

  for (const key of requiredKeys) {
    if (!present(environment[key])) {
      throw new Error(
        `Refusing to release to ${target}: ${key} is missing from the loaded environment.`,
      );
    }
  }

  const appHost = hostOf(
    environment.BETTER_AUTH_URL as string,
    "BETTER_AUTH_URL",
  );
  const browserHost = hostOf(
    environment.NEXT_PUBLIC_APP_URL as string,
    "NEXT_PUBLIC_APP_URL",
  );

  if (appHost !== browserHost) {
    throw new Error(
      `Refusing to release to ${target}: BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL must resolve to the same host.`,
    );
  }

  const databaseHost = databaseHostOf(environment.DATABASE_URL as string);

  return { target, appHost, databaseHost };
}

/**
 * Extracts the `host[:port]` portion of a Postgres connection string without
 * its credentials, so it can be surfaced in a log line safely. Node's URL
 * parser rejects some connection-string shapes, so we isolate the authority and
 * strip any `user:pass@` prefix by hand.
 */
function databaseHostOf(connectionString: string): string {
  const withoutScheme = connectionString.replace(/^[a-z0-9+]+:\/\//i, "");
  const authority = withoutScheme.split("/")[0] ?? "";
  const hostPort = authority.includes("@")
    ? (authority.split("@").at(-1) ?? "")
    : authority;

  if (hostPort.trim() === "") {
    throw new Error("DATABASE_URL is not a valid connection string.");
  }

  return hostPort;
}

/**
 * Runtime guard: a preview deployment must never carry production
 * configuration. Wired into the app boot path so an accidental scope leak
 * (production env vars attached to Preview) fails loudly instead of exposing
 * production data to a throwaway preview URL.
 */
export function assertPreviewIsolation(
  environment: ReleaseEnvironment = process.env,
): void {
  if (
    environment.VERCEL_ENV === "preview" &&
    environment.APP_ENV === "production"
  ) {
    throw new Error(
      "Preview deployments must never receive production configuration (APP_ENV=production on a Preview environment).",
    );
  }
}
