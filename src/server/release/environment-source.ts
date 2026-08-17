/**
 * Chooses where a release script loads a target environment from.
 *
 * `vercel env pull` cannot return a variable stored as **Sensitive**. Vercel
 * decrypts those only into the deployment runtime and writes the literal
 * string `[SENSITIVE]` into the pulled file instead. A project that marks its
 * secrets Sensitive therefore cannot be verified from a pulled environment at
 * all: every guard in `environment.ts` would compare a placeholder rather than
 * the real value, and the release would fail with a confusing mismatch
 * (`APP_ENV="[SENSITIVE]"`) far from the actual cause.
 *
 * So a release may instead read the target's variables from a local file the
 * operator maintains — `.env.production.local`, matched by the `.env*` rule in
 * `.gitignore` so it is never committed. When that file exists it wins; when it
 * does not, we still pull from Vercel, but a pulled environment carrying
 * placeholders fails closed with an error naming the file to create.
 *
 * Choosing the source is all this module does. The loaded environment still has
 * to satisfy `assertReleaseEnvironment`, so a local file holding the wrong
 * tier's configuration is rejected exactly like a mispulled one.
 */

import type { ReleaseTarget } from "./environment";

/** Written by `vercel env pull` in place of a Sensitive variable's value. */
export const SENSITIVE_PLACEHOLDER = "[SENSITIVE]";

/** Local override file a release reads instead of pulling from Vercel. */
export function localEnvironmentFile(target: ReleaseTarget): string {
  return `.env.${target}.local`;
}

/**
 * Names the variables that came back as placeholders rather than values,
 * sorted so the error message is stable. Only keys are ever returned — a real
 * value is never read out of the environment here.
 */
export function findUnreadableKeys(
  environment: Record<string, string | undefined>,
): string[] {
  return Object.keys(environment)
    .filter((key) => environment[key]?.trim() === SENSITIVE_PLACEHOLDER)
    .sort();
}

interface AssertReadableEnvironmentOptions {
  target: ReleaseTarget;
  environment: Record<string, string | undefined>;
  /** Where the environment came from, for the error message. */
  source: string;
}

/**
 * Fails closed when the loaded environment carries Sensitive placeholders
 * instead of values, naming the offending variables and the fix. Without this
 * the release still stops, but on a downstream guard whose message points at
 * the wrong problem.
 */
export function assertReadableEnvironment({
  target,
  environment,
  source,
}: AssertReadableEnvironmentOptions): void {
  const unreadable = findUnreadableKeys(environment);

  if (unreadable.length === 0) {
    return;
  }

  const file = localEnvironmentFile(target);

  throw new Error(
    `Refusing to release to ${target}: ${unreadable.length} variable(s) from ${source} are stored as Sensitive and cannot be read back — ${unreadable.join(", ")}. ` +
      `Create ${file} with the real values (it is gitignored) and re-run; the release reads that file in preference to Vercel.`,
  );
}
