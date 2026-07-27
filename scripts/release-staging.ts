import { execFileSync } from "node:child_process";

import { runCommand } from "./run-command";

const STAGING_DOMAIN = "adhdrails-staging.vercel.app";

const migrationEnvironment = {
  ...process.env,
  MIGRATION_PHASE: "expand",
};

await runCommand("pnpm", ["db:migrate"], migrationEnvironment);

// The Hobby plan has no custom environments, so staging ships as a Preview
// deployment of the `staging` branch. It inherits the branch-scoped
// `Preview (staging)` environment variables, then we repoint the stable
// staging domain at the deployment we just created.
const deployOutput = execFileSync(
  "pnpm",
  ["exec", "vercel", "deploy", "--yes"],
  {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  },
);

const deploymentUrl = parseDeploymentUrl(deployOutput);

if (!deploymentUrl) {
  throw new Error(
    `Could not parse a deployment URL from vercel output:\n${deployOutput}`,
  );
}

function parseDeploymentUrl(output: string): string | undefined {
  // In non-interactive mode the Vercel CLI prints a JSON envelope; when a TTY
  // is attached it prints the bare deployment URL. Handle both.
  try {
    const parsed = JSON.parse(output.trim());
    const url = parsed?.deployment?.url;
    if (typeof url === "string" && url.length > 0) {
      return url;
    }
  } catch {
    // Not JSON — fall through to scanning for a bare URL.
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("https://"))
    .at(-1);
}

await runCommand("pnpm", [
  "exec",
  "vercel",
  "alias",
  "set",
  deploymentUrl,
  STAGING_DOMAIN,
]);
