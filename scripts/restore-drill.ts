import nextEnv from "@next/env";

import { runRestoreDrill } from "../src/server/release/restore-drill";

/**
 * Runs a Neon point-in-time restore drill against the production project and
 * prints the recovery time. Requires NEON_API_KEY, NEON_PROJECT_ID, and
 * NEON_BRANCH_ID (the production branch) in the environment. Record the reported
 * time in `docs/runbooks/restore-drill.md` after each run.
 */
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const result = await runRestoreDrill();

const minutes = (result.elapsedMs / 60_000).toFixed(1);
console.log(
  `Restore drill passed · recovered branch ${result.restoreBranchId} in ${minutes} min · cleaned up: ${result.cleanedUp}`,
);
