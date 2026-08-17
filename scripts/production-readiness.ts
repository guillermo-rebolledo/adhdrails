import { readFile, writeFile } from "node:fs/promises";

import nextEnv from "@next/env";

import { ensureSeedEnvironment } from "../src/server/db/seed";
import { assertPreviewIsolation } from "../src/server/release/environment";
import { assertExpandOnlyMigrations } from "../src/server/release/migrations";
import { assertPitrRetention } from "../src/server/release/neon-retention";
import {
  type ReadinessCheck,
  renderProductionReadinessReport,
  summarizeReadiness,
} from "../src/server/release/readiness";

/**
 * Release rehearsal.
 *
 * Exercises the automated production safeguards, records each result as
 * pass/fail evidence, tracks the remaining human launch dependencies, and
 * writes `docs/production-readiness.md`. It never silently relaxes a check: an
 * automated regression makes the process exit non-zero, and human dependencies
 * (OAuth verification, restore drill) stay listed rather than being marked done.
 */
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const REPORT_PATH = "docs/production-readiness.md";
const ISOLATED_SYSTEMS = [
  "OAuth",
  "database",
  "Inngest",
  "VAPID",
  "analytics",
  "secret",
];

const checks: ReadinessCheck[] = [];

checks.push(await seedSafeguardCheck());
checks.push(await migrationSafetyCheck());
checks.push(await verificationCommandCheck());
checks.push(await environmentDocumentationCheck());
checks.push(await previewIsolationCheck());
checks.push(await pitrRetentionCheck());
checks.push(oauthLaunchDependency());
checks.push(restoreDrillDependency());

const generatedAt = new Date().toISOString();
const report = renderProductionReadinessReport({ checks, generatedAt });
await writeFile(REPORT_PATH, report, "utf8");

const summary = summarizeReadiness(checks);
console.log(
  `Release rehearsal: ${summary.overallStatus.toUpperCase()} · ` +
    `${summary.counts.pass} pass · ${summary.counts.fail} fail · ${summary.counts.manual} manual`,
);
console.log(`Report written to ${REPORT_PATH}`);

if (summary.hasFailures) {
  process.exitCode = 1;
}

async function seedSafeguardCheck(): Promise<ReadinessCheck> {
  const rejects = (environment: Record<string, string>): boolean => {
    try {
      ensureSeedEnvironment(environment);
      return false;
    } catch {
      return true;
    }
  };

  const blocksProduction = rejects({
    APP_ENV: "production",
    NODE_ENV: "production",
  });
  const blocksStaging = rejects({ APP_ENV: "staging" });

  return blocksProduction && blocksStaging
    ? {
        name: "Seed safeguards",
        status: "pass",
        evidence:
          "Seeding is rejected under APP_ENV=production and APP_ENV=staging; only local/test may seed.",
      }
    : {
        name: "Seed safeguards",
        status: "fail",
        evidence:
          "Seeding was NOT rejected for a deployed environment — production seeding is not disabled by construction.",
      };
}

async function migrationSafetyCheck(): Promise<ReadinessCheck> {
  try {
    await assertExpandOnlyMigrations("./drizzle");
    return {
      name: "Expand-contract migration safety",
      status: "pass",
      evidence:
        "Every committed migration is labelled `-- migration-phase: expand`; contract steps must ship separately.",
    };
  } catch (error) {
    return {
      name: "Expand-contract migration safety",
      status: "fail",
      evidence: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verificationCommandCheck(): Promise<ReadinessCheck> {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  const verify = packageJson.scripts?.verify ?? "";
  const releaseCheck = packageJson.scripts?.["release:check"] ?? "";
  const requiredStages = [
    "format:check",
    "lint",
    "typecheck",
    "test",
    "build",
    "lighthouse",
  ];
  const missing = requiredStages.filter((stage) => !verify.includes(stage));

  return missing.length === 0 && releaseCheck.includes("verify")
    ? {
        name: "Full verification command",
        status: "pass",
        evidence: `\`pnpm verify\` runs ${requiredStages.join(", ")}; \`release:check\` gates every release on it.`,
      }
    : {
        name: "Full verification command",
        status: "fail",
        evidence: `Verification command is incomplete (missing: ${missing.join(", ") || "release:check wiring"}).`,
      };
}

async function environmentDocumentationCheck(): Promise<ReadinessCheck> {
  const checklist = await readFile("docs/deployment-checklist.md", "utf8");
  const envExample = await readFile(".env.example", "utf8");
  const corpus = `${checklist}\n${envExample}`.toLowerCase();
  const missing = ISOLATED_SYSTEMS.filter(
    (system) => !corpus.includes(system.toLowerCase()),
  );

  return missing.length === 0
    ? {
        name: "Environment documentation",
        status: "pass",
        evidence:
          "Deployment checklist and .env.example document isolated OAuth, database, Inngest, VAPID, analytics, and secret configuration per environment.",
      }
    : {
        name: "Environment documentation",
        status: "fail",
        evidence: `Documentation does not cover: ${missing.join(", ")}.`,
      };
}

async function previewIsolationCheck(): Promise<ReadinessCheck> {
  // Exercise the guard's behaviour, not just its presence: it must reject a
  // Preview carrying production config and allow an isolated Preview.
  const rejectsProductionOnPreview = throws(() =>
    assertPreviewIsolation({ VERCEL_ENV: "preview", APP_ENV: "production" }),
  );
  const allowsIsolatedPreview = !throws(() =>
    assertPreviewIsolation({ VERCEL_ENV: "preview", APP_ENV: "staging" }),
  );
  const wiredIntoBoot = (
    await readFile("src/instrumentation.ts", "utf8")
  ).includes("assertPreviewIsolation");

  return rejectsProductionOnPreview && allowsIsolatedPreview && wiredIntoBoot
    ? {
        name: "Preview isolation guard",
        status: "pass",
        evidence:
          "assertPreviewIsolation() rejects a Preview carrying APP_ENV=production, allows an isolated Preview, and runs at app boot (src/instrumentation.ts).",
      }
    : {
        name: "Preview isolation guard",
        status: "fail",
        evidence: `Preview isolation guard is not enforced end to end (rejects production-on-preview: ${rejectsProductionOnPreview}, allows isolated preview: ${allowsIsolatedPreview}, wired into boot: ${wiredIntoBoot}).`,
      };
}

function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

async function pitrRetentionCheck(): Promise<ReadinessCheck> {
  if (!process.env.NEON_API_KEY || !process.env.NEON_PROJECT_ID) {
    return {
      name: "Neon PITR retention (≥ 7 days)",
      status: "manual",
      evidence:
        "Provide NEON_API_KEY and NEON_PROJECT_ID and rerun; retention must be at least 7 days.",
    };
  }

  try {
    const retention = await assertPitrRetention();
    return {
      name: "Neon PITR retention (≥ 7 days)",
      status: "pass",
      evidence: `Neon reports ${retention.retentionDays} days of point-in-time recovery history.`,
    };
  } catch (error) {
    return {
      name: "Neon PITR retention (≥ 7 days)",
      status: "fail",
      evidence: error instanceof Error ? error.message : String(error),
    };
  }
}

function oauthLaunchDependency(): ReadinessCheck {
  return {
    name: "Google OAuth verification",
    status: "manual",
    evidence:
      "Google OAuth consent-screen verification is a human launch dependency; production sign-in and Calendar access depend on it. Confirm the verified state per environment before launch.",
  };
}

function restoreDrillDependency(): ReadinessCheck {
  return {
    name: "Restore drill (4-hour RTO)",
    status: "manual",
    evidence:
      "Run `pnpm restore:drill` before launch and after meaningful schema changes; record the recovery time in docs/runbooks/restore-drill.md. The initial recovery-time objective is four hours.",
  };
}
