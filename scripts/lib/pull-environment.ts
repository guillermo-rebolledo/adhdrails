import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseEnvFile } from "../../src/server/release/env-file";
import type { ReleaseTarget } from "../../src/server/release/environment";

/**
 * Pulls a deployment target's environment variables with `vercel env pull` into
 * a private temporary file, parses them, and removes the file. The Vercel CLI
 * prints only a count of downloaded variables (never their values), and the
 * temporary file is deleted immediately, so no secret reaches stdout or lingers
 * on disk after the release script exits.
 *
 * Requires the working directory to be linked to the Vercel project
 * (`vercel link`). `staging` resolves to the Pro custom environment of the same
 * name; `production` resolves to the built-in Production environment.
 */
export function pullTargetEnvironment(
  target: ReleaseTarget,
): Record<string, string> {
  const directory = mkdtempSync(path.join(tmpdir(), "rails-release-"));
  const file = path.join(directory, ".env.pulled");

  try {
    execFileSync(
      "pnpm",
      ["exec", "vercel", "env", "pull", file, "--environment", target, "--yes"],
      { stdio: ["inherit", "inherit", "inherit"] },
    );

    return parseEnvFile(readFileSync(file, "utf8"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
