/**
 * Neon restore drill.
 *
 * The MVP spec sets a four-hour initial recovery-time objective (RTO) and
 * requires a restore drill before launch and after meaningful schema changes.
 * This drill exercises Neon's point-in-time recovery control plane: it creates a
 * fresh branch from the production branch's history, waits for the restore
 * operation to complete, and measures how long that took. It fails if recovery
 * does not complete within the objective, and tears the throwaway branch down
 * again so the drill leaves no residue.
 *
 * Neon PITR branching is copy-on-write, so a successful drill proves recovery is
 * achievable far inside the RTO; verifying the restored branch is actually
 * queryable (the data plane) is a manual step in the runbook
 * (`docs/runbooks/restore-drill.md`), as is the decision to promote a restored
 * branch during a real incident.
 */

import {
  isRecord,
  neonHeaders,
  neonJson,
  neonProjectUrl,
  pollNeonOperations,
  requireNeonEnv,
} from "./neon-client";

type NeonEnvironment = Record<string, string | undefined>;

interface RunRestoreDrillOptions {
  environment?: NeonEnvironment;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  clock?: () => number;
  /** Delete the restore branch once the drill finishes. Defaults to true. */
  cleanup?: boolean;
}

export interface RestoreDrillResult {
  restoreBranchId: string;
  elapsedMs: number;
  cleanedUp: boolean;
}

/** Four-hour initial recovery-time objective. */
export const RESTORE_TIME_OBJECTIVE_MS = 4 * 60 * 60 * 1000;

const POLL_INTERVAL_MS = 2_000;
const OBJECTIVE_HOURS = RESTORE_TIME_OBJECTIVE_MS / (60 * 60 * 1000);
const PURPOSE = "to run a restore drill";

function restoreBranchFrom(payload: unknown): {
  branchId: string;
  operationIds: string[];
} {
  if (
    !isRecord(payload) ||
    !isRecord(payload.branch) ||
    typeof payload.branch.id !== "string" ||
    !Array.isArray(payload.operations)
  ) {
    throw new Error("Neon restore-branch response was invalid.");
  }

  const operationIds = payload.operations.map((operation) => {
    if (!isRecord(operation) || typeof operation.id !== "string") {
      throw new Error("Neon restore-branch response was invalid.");
    }

    return operation.id;
  });

  return { branchId: payload.branch.id, operationIds };
}

/**
 * Runs a point-in-time restore drill and returns timing evidence. Throws if the
 * restore fails or does not complete within {@link RESTORE_TIME_OBJECTIVE_MS};
 * a successful return therefore always means recovery was inside the objective.
 */
export async function runRestoreDrill({
  environment = process.env,
  fetchImplementation = fetch,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  clock = () => Date.now(),
  cleanup = true,
}: RunRestoreDrillOptions = {}): Promise<RestoreDrillResult> {
  const apiKey = requireNeonEnv(environment, "NEON_API_KEY", PURPOSE);
  const projectId = requireNeonEnv(environment, "NEON_PROJECT_ID", PURPOSE);
  const parentBranchId = requireNeonEnv(environment, "NEON_BRANCH_ID", PURPOSE);
  const baseUrl = neonProjectUrl(projectId);
  const headers = neonHeaders(apiKey, { "content-type": "application/json" });

  const startedAt = clock();

  // Create a read-only branch from the parent branch's history. Without a
  // parent_timestamp Neon restores from the latest recoverable point, which is
  // what the drill exercises.
  const createResponse = await fetchImplementation(`${baseUrl}/branches`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      branch: { parent_id: parentBranchId, name: "rails-restore-drill" },
      endpoints: [{ type: "read_only" }],
    }),
  });
  const { branchId, operationIds } = restoreBranchFrom(
    await neonJson(createResponse, "Neon restore-branch creation"),
  );

  // The recovery-time objective doubles as the drill's poll bound: if recovery
  // has not completed by the objective, the drill has already failed.
  await pollNeonOperations({
    baseUrl,
    headers,
    operationIds,
    fetchImplementation,
    sleep,
    clock,
    deadline: startedAt + RESTORE_TIME_OBJECTIVE_MS,
    pollIntervalMs: POLL_INTERVAL_MS,
    timeoutMessage: `Restore drill exceeded the ${OBJECTIVE_HOURS}-hour recovery objective before recovery completed.`,
    failureMessage: "Neon restore operation failed.",
  });

  const elapsedMs = clock() - startedAt;

  let cleanedUp = false;
  if (cleanup) {
    const deleteResponse = await fetchImplementation(
      `${baseUrl}/branches/${encodeURIComponent(branchId)}`,
      { method: "DELETE", headers },
    );
    cleanedUp = deleteResponse.ok;
  }

  return { restoreBranchId: branchId, elapsedMs, cleanedUp };
}
