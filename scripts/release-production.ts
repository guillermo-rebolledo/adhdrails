import { createInterface } from "node:readline/promises";

import { runCommand } from "./run-command";
import { pullTargetEnvironment } from "./lib/pull-environment";
import { assertReleaseEnvironment } from "../src/server/release/environment";
import { assertPitrRetention } from "../src/server/release/neon-retention";
import { createNeonRestorePoint } from "../src/server/release/neon-snapshot";

/**
 * Production release.
 *
 * Order matters and every step fails closed:
 *   1. Typed confirmation.
 *   2. Pull and verify the production environment before any mutation, so a
 *      stale or staging configuration can never drive a production release.
 *   3. Confirm Neon point-in-time recovery retains at least seven days.
 *   4. Create and verify a Neon restore point.
 *   5. Run expand-only migrations.
 *   6. Deploy to production.
 * No secret is printed at any step.
 */
const confirmation = "release Rails to production";
const prompt = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const answer = await prompt.question(
  `Type "${confirmation}" to continue with the production release: `,
);
prompt.close();

if (answer !== confirmation) {
  throw new Error("Production release canceled: confirmation did not match.");
}

const pulled = pullTargetEnvironment("production");
const environment = { ...process.env, ...pulled };

const summary = assertReleaseEnvironment({ target: "production", environment });
console.log(
  `Verified production environment · app ${summary.appHost} · db ${summary.databaseHost}`,
);

const retention = await assertPitrRetention({ environment });
console.log(
  `Neon point-in-time recovery retention: ${retention.retentionDays} days.`,
);

await createNeonRestorePoint({ environment });

await runCommand("pnpm", ["db:migrate"], {
  ...environment,
  MIGRATION_PHASE: "expand",
});

await runCommand("pnpm", ["exec", "vercel", "deploy", "--prod", "--yes"]);

console.log("Production release complete.");
