/**
 * Neon point-in-time recovery (PITR) retention verification.
 *
 * The MVP spec requires at least seven days of PITR history so a production
 * incident can be recovered to any recent instant. This check reads the
 * project's configured `history_retention_seconds` from the Neon API and fails
 * closed if it is shorter than the required window, so a release never proceeds
 * believing it has recovery coverage it does not actually have.
 */

import {
  isRecord,
  neonHeaders,
  neonJson,
  neonProjectUrl,
  requireNeonEnv,
} from "./neon-client";

type NeonEnvironment = Record<string, string | undefined>;

interface AssertPitrRetentionOptions {
  environment?: NeonEnvironment;
  fetchImplementation?: typeof fetch;
}

export interface PitrRetentionSummary {
  retentionSeconds: number;
  retentionDays: number;
}

export const MINIMUM_RETENTION_DAYS = 7;
const SECONDS_PER_DAY = 24 * 60 * 60;
const MINIMUM_RETENTION_SECONDS = MINIMUM_RETENTION_DAYS * SECONDS_PER_DAY;
const PURPOSE = "to verify Neon PITR retention";

function retentionSecondsFrom(payload: unknown): number {
  if (
    !isRecord(payload) ||
    !isRecord(payload.project) ||
    typeof payload.project.history_retention_seconds !== "number"
  ) {
    throw new Error("Neon project response was invalid.");
  }

  return payload.project.history_retention_seconds;
}

/**
 * Verifies the Neon project retains at least {@link MINIMUM_RETENTION_DAYS} days
 * of point-in-time recovery history. Returns the observed retention so the
 * caller can record it as evidence.
 */
export async function assertPitrRetention({
  environment = process.env,
  fetchImplementation = fetch,
}: AssertPitrRetentionOptions = {}): Promise<PitrRetentionSummary> {
  const apiKey = requireNeonEnv(environment, "NEON_API_KEY", PURPOSE);
  const projectId = requireNeonEnv(environment, "NEON_PROJECT_ID", PURPOSE);

  const response = await fetchImplementation(neonProjectUrl(projectId), {
    headers: neonHeaders(apiKey),
  });
  const retentionSeconds = retentionSecondsFrom(
    await neonJson(response, "Neon retention lookup"),
  );
  const retentionDays = Math.floor(retentionSeconds / SECONDS_PER_DAY);

  if (retentionSeconds < MINIMUM_RETENTION_SECONDS) {
    throw new Error(
      `Neon point-in-time recovery retention is ${retentionDays} days; at least ${MINIMUM_RETENTION_DAYS} days are required.`,
    );
  }

  return { retentionSeconds, retentionDays };
}
