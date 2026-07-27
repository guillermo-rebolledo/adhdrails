type NeonEnvironment = Record<string, string | undefined>;

type CreateRestorePointOptions = {
  environment?: NeonEnvironment;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

const TERMINAL_FAILURES = new Set(["cancelled", "error", "failed", "skipped"]);
const OPERATION_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

function requiredEnvironment(
  environment: NeonEnvironment,
  name: keyof NeonEnvironment,
): string {
  const value = environment[name];

  if (!value) {
    throw new Error(`${name} is required for a production restore point.`);
  }

  return value;
}

function operationIdsFrom(payload: unknown): string[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("snapshot" in payload) ||
    !("operations" in payload) ||
    !Array.isArray(payload.operations)
  ) {
    throw new Error("Neon restore-point response was invalid.");
  }

  const ids = payload.operations.map((operation) => {
    if (
      !operation ||
      typeof operation !== "object" ||
      !("id" in operation) ||
      typeof operation.id !== "string"
    ) {
      throw new Error("Neon restore-point response was invalid.");
    }

    return operation.id;
  });

  return ids;
}

function operationStatusFrom(payload: unknown): string {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("operation" in payload) ||
    !payload.operation ||
    typeof payload.operation !== "object" ||
    !("status" in payload.operation) ||
    typeof payload.operation.status !== "string"
  ) {
    throw new Error("Neon operation response was invalid.");
  }

  return payload.operation.status;
}

async function responseJson(response: Response, action: string) {
  if (!response.ok) {
    throw new Error(`${action} failed with status ${response.status}.`);
  }

  return response.json() as Promise<unknown>;
}

export async function createNeonRestorePoint({
  environment = process.env,
  fetchImplementation = fetch,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
}: CreateRestorePointOptions = {}): Promise<void> {
  const apiKey = requiredEnvironment(environment, "NEON_API_KEY");
  const projectId = requiredEnvironment(environment, "NEON_PROJECT_ID");
  const branchId = requiredEnvironment(environment, "NEON_BRANCH_ID");
  const baseUrl = `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}`;
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  const snapshotResponse = await fetchImplementation(
    `${baseUrl}/branches/${encodeURIComponent(branchId)}/snapshot`,
    { method: "POST", headers },
  );
  const operationIds = operationIdsFrom(
    await responseJson(snapshotResponse, "Neon restore-point creation"),
  );
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;

  for (const operationId of operationIds) {
    while (true) {
      if (Date.now() >= deadline) {
        throw new Error("Neon restore-point verification timed out.");
      }

      const operationResponse = await fetchImplementation(
        `${baseUrl}/operations/${encodeURIComponent(operationId)}`,
        { headers },
      );
      const status = operationStatusFrom(
        await responseJson(operationResponse, "Neon operation verification"),
      );

      if (status === "finished") {
        break;
      }

      if (TERMINAL_FAILURES.has(status)) {
        throw new Error("Neon restore-point operation failed.");
      }

      await sleep(POLL_INTERVAL_MS);
    }
  }

  console.log("Neon restore point created and verified.");
}
