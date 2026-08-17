import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseEnvFile } from "../../src/server/release/env-file";
import {
  assertReadableEnvironment,
  localEnvironmentFile,
} from "../../src/server/release/environment-source";
import type { ReleaseTarget } from "../../src/server/release/environment";

/**
 * Loads a deployment target's environment variables for a release.
 *
 * Prefers a local, gitignored `.env.<target>.local` when the operator keeps
 * one. This is the only workable source for a project whose variables are
 * stored as Sensitive in Vercel, because `vercel env pull` returns the
 * placeholder `[SENSITIVE]` for those rather than their values — see
 * `src/server/release/environment-source.ts`.
 *
 * Otherwise pulls with `vercel env pull` into a private temporary file, parses
 * it, and removes the file. The Vercel CLI prints only a count of downloaded
 * variables (never their values), and the temporary file is deleted
 * immediately, so no secret reaches stdout or lingers on disk after the release
 * script exits.
 *
 * Either way the result must still satisfy `assertReleaseEnvironment`, so a
 * local file holding the wrong tier's configuration fails closed just as a
 * mispulled environment does.
 *
 * Pulling requires the working directory to be linked to the Vercel project
 * (`vercel link`). `staging` resolves to the Pro custom environment of the same
 * name; `production` resolves to the built-in Production environment.
 */
export function pullTargetEnvironment(
  target: ReleaseTarget,
): Record<string, string> {
  const localFile = localEnvironmentFile(target);

  if (existsSync(localFile)) {
    console.log(`Loading ${target} environment from ${localFile}.`);
    const environment = parseEnvFile(readFileSync(localFile, "utf8"));
    assertReadableEnvironment({ target, environment, source: localFile });
    return environment;
  }

  const directory = mkdtempSync(path.join(tmpdir(), "rails-release-"));
  const file = path.join(directory, ".env.pulled");

  try {
    execFileSync(
      "pnpm",
      ["exec", "vercel", "env", "pull", file, "--environment", target, "--yes"],
      { stdio: ["inherit", "inherit", "inherit"] },
    );

    const environment = parseEnvFile(readFileSync(file, "utf8"));
    assertReadableEnvironment({
      target,
      environment,
      source: "vercel env pull",
    });
    return environment;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
