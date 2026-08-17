import { runCommand } from "./run-command";
import { pullTargetEnvironment } from "./lib/pull-environment";
import { assertReleaseEnvironment } from "../src/server/release/environment";

/**
 * Staging release.
 *
 * Staging is a first-class Vercel custom environment (Pro) named `staging` with
 * its own isolated variables and stable domain — not a Preview alias. The script
 * pulls that environment, verifies it actually is staging before mutating
 * anything, runs expand-only migrations, then deploys to the custom
 * environment. It is fail-fast: any step that throws stops the release, and no
 * secret is printed.
 */
const pulled = pullTargetEnvironment("staging");
const environment = { ...process.env, ...pulled };

const summary = assertReleaseEnvironment({ target: "staging", environment });
console.log(
  `Verified staging environment · app ${summary.appHost} · db ${summary.databaseHost}`,
);

await runCommand("pnpm", ["db:migrate"], {
  ...environment,
  MIGRATION_PHASE: "expand",
});

await runCommand("pnpm", [
  "exec",
  "vercel",
  "deploy",
  "--target",
  "staging",
  "--yes",
]);

console.log("Staging release complete.");
