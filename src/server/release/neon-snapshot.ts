import {
  isRecord,
  neonHeaders,
  neonJson,
  neonProjectUrl,
  pollNeonOperations,
  requireNeonEnv,
} from "./neon-client";

type NeonEnvironment = Record<string, string | undefined>;

type CreateRestorePointOptions = {
  environment?: NeonEnvironment;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

const OPERATION_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;
const PURPOSE = "for a production restore point";

function operationIdsFrom(payload: unknown): string[] {
  if (
    !isRecord(payload) ||
    !("snapshot" in payload) ||
    !Array.isArray(payload.operations)
  ) {
    throw new Error("Neon restore-point response was invalid.");
  }

  return payload.operations.map((operation) => {
    if (!isRecord(operation) || typeof operation.id !== "string") {
      throw new Error("Neon restore-point response was invalid.");
    }

    return operation.id;
  });
}

export async function createNeonRestorePoint({
  environment = process.env,
  fetchImplementation = fetch,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
}: CreateRestorePointOptions = {}): Promise<void> {
  const apiKey = requireNeonEnv(environment, "NEON_API_KEY", PURPOSE);
  const projectId = requireNeonEnv(environment, "NEON_PROJECT_ID", PURPOSE);
  const branchId = requireNeonEnv(environment, "NEON_BRANCH_ID", PURPOSE);
  const baseUrl = neonProjectUrl(projectId);
  const headers = neonHeaders(apiKey);

  const snapshotResponse = await fetchImplementation(
    `${baseUrl}/branches/${encodeURIComponent(branchId)}/snapshot`,
    { method: "POST", headers },
  );
  const operationIds = operationIdsFrom(
    await neonJson(snapshotResponse, "Neon restore-point creation"),
  );

  await pollNeonOperations({
    baseUrl,
    headers,
    operationIds,
    fetchImplementation,
    sleep,
    clock: () => Date.now(),
    deadline: Date.now() + OPERATION_TIMEOUT_MS,
    pollIntervalMs: POLL_INTERVAL_MS,
    timeoutMessage: "Neon restore-point verification timed out.",
    failureMessage: "Neon restore-point operation failed.",
  });

  console.log("Neon restore point created and verified.");
}
