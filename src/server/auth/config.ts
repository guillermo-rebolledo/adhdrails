import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import type { Database } from "@/server/db/connection";
import { account, session, user, verification } from "@/server/db/schema";

export interface AuthEnvironment {
  secret: string;
  baseURL: string;
  googleClientId: string;
  googleClientSecret: string;
}

const DEVELOPMENT_SECRET = "rails-development-only-secret-change-me";
const DEVELOPMENT_GOOGLE_PLACEHOLDER = "rails-development-google-placeholder";

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}

function requireInProduction(
  value: string | undefined,
  name: string,
  developmentFallback: string,
): string {
  if (value && value.trim() !== "") {
    return value;
  }

  if (isProductionRuntime()) {
    throw new Error(`${name} is required in production.`);
  }

  return developmentFallback;
}

/**
 * Reads authentication configuration from the environment. Production requires
 * real secrets; local and test runtimes fall back to placeholders so the server
 * can boot without live Google credentials (real sign-in still needs them).
 */
export function readAuthEnvironment(): AuthEnvironment {
  return {
    secret: requireInProduction(
      process.env.BETTER_AUTH_SECRET,
      "BETTER_AUTH_SECRET",
      DEVELOPMENT_SECRET,
    ),
    baseURL:
      process.env.BETTER_AUTH_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000",
    googleClientId: requireInProduction(
      process.env.GOOGLE_CLIENT_ID,
      "GOOGLE_CLIENT_ID",
      DEVELOPMENT_GOOGLE_PLACEHOLDER,
    ),
    googleClientSecret: requireInProduction(
      process.env.GOOGLE_CLIENT_SECRET,
      "GOOGLE_CLIENT_SECRET",
      DEVELOPMENT_GOOGLE_PLACEHOLDER,
    ),
  };
}

export interface CreateAuthOptions {
  /**
   * Enables an email/password flow used ONLY by the test-only session bootstrap
   * so Playwright can establish a signed session without real Google OAuth. It
   * is never enabled in the production runtime and is not surfaced in the UI.
   */
  enableTestCredentials?: boolean;
}

/**
 * Builds the Better Auth instance. Google is the only identity provider and no
 * email/password flow is enabled. Only identity scopes are requested here;
 * incremental Google Calendar authorization is a separate flow (MEM-39).
 */
export function createAuth(
  database: Database,
  env: AuthEnvironment,
  options: CreateAuthOptions = {},
) {
  return betterAuth({
    secret: env.secret,
    baseURL: env.baseURL,
    trustedOrigins: [env.baseURL],
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: options.enableTestCredentials
      ? { enabled: true, autoSignIn: true, minPasswordLength: 8 }
      : { enabled: false },
    socialProviders: {
      google: {
        clientId: env.googleClientId,
        clientSecret: env.googleClientSecret,
        scope: ["openid", "email", "profile"],
      },
    },
    user: {
      additionalFields: {
        timezone: {
          type: "string",
          required: false,
          defaultValue: "UTC",
          input: false,
        },
        locale: {
          type: "string",
          required: false,
          defaultValue: "en-US",
          input: false,
        },
        onboardingCompletedAt: {
          type: "date",
          required: false,
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
