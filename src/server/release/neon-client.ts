/**
 * Shared Neon API scaffolding for the release checks.
 *
 * The restore-point, retention, and restore-drill checks all talk to the same
 * Neon Console API: they read the same credentials, build the same base URL and
 * auth headers, decode the same operation envelopes, and poll the same
 * asynchronous operations to completion. This module holds that common ground so
 * each check contains only its own request and its own success criteria.
 */

type NeonEnvironment = Record<string, string | undefined>;

const NEON_API_BASE = "https://console.neon.tech/api/v2";
const TERMINAL_FAILURES = new Set(["cancelled", "error", "failed", "skipped"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads a required Neon credential. `purpose` completes the sentence
 * "`<NAME>` is required <purpose>." so the failure explains which check needs it.
 */
export function requireNeonEnv(
  environment: NeonEnvironment,
  name: string,
  purpose: string,
): string {
  const value = environment[name];

  if (!value) {
    throw new Error(`${name} is required ${purpose}.`);
  }

  return value;
}

export function neonProjectUrl(projectId: string): string {
  return `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}`;
}

export function neonHeaders(
  apiKey: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
    ...extra,
  };
}

/** Reads a JSON body, converting a non-OK status into a labelled error. */
export async function neonJson(
  response: Response,
  action: string,
): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${action} failed with status ${response.status}.`);
  }

  return response.json() as Promise<unknown>;
}

export function operationStatusFrom(payload: unknown): string {
  if (
    !isRecord(payload) ||
    !isRecord(payload.operation) ||
    typeof payload.operation.status !== "string"
  ) {
    throw new Error("Neon operation response was invalid.");
  }

  return payload.operation.status;
}

interface PollNeonOperationsOptions {
  baseUrl: string;
  headers: Record<string, string>;
  operationIds: readonly string[];
  fetchImplementation: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  clock: () => number;
  /** Absolute time (from `clock`) past which the wait fails closed. */
  deadline: number;
  pollIntervalMs: number;
  timeoutMessage: string;
  failureMessage: string;
}

/**
 * Waits for each Neon operation to reach `finished`, sleeping between polls.
 * Throws `timeoutMessage` if `clock()` passes `deadline` and `failureMessage` if
 * an operation reaches a terminal failure state. The caller supplies the clock
 * and deadline so the same loop serves a wall-clock timeout (restore point) and
 * a recovery-objective bound (restore drill).
 */
export async function pollNeonOperations({
  baseUrl,
  headers,
  operationIds,
  fetchImplementation,
  sleep,
  clock,
  deadline,
  pollIntervalMs,
  timeoutMessage,
  failureMessage,
}: PollNeonOperationsOptions): Promise<void> {
  for (const operationId of operationIds) {
    while (true) {
      if (clock() >= deadline) {
        throw new Error(timeoutMessage);
      }

      const operationResponse = await fetchImplementation(
        `${baseUrl}/operations/${encodeURIComponent(operationId)}`,
        { headers },
      );
      const status = operationStatusFrom(
        await neonJson(operationResponse, "Neon operation verification"),
      );

      if (status === "finished") {
        break;
      }

      if (TERMINAL_FAILURES.has(status)) {
        throw new Error(failureMessage);
      }

      await sleep(pollIntervalMs);
    }
  }
}
