import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runCommand } from "./run-command";

const execFileAsync = promisify(execFile);
const containerName = `rails-test-postgres-${process.pid}`;

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await execFileAsync("docker", [
        "exec",
        containerName,
        "pg_isready",
        "--username",
        "rails",
        "--dbname",
        "rails_test",
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error("Ephemeral PostgreSQL did not become ready.");
}

try {
  await runCommand("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "--env",
    "POSTGRES_USER=rails",
    "--env",
    "POSTGRES_PASSWORD=rails",
    "--env",
    "POSTGRES_DB=rails_test",
    "--publish",
    "127.0.0.1::5432",
    "postgres:17-alpine",
  ]);

  await waitForPostgres();

  const { stdout } = await execFileAsync("docker", [
    "port",
    containerName,
    "5432/tcp",
  ]);
  const port = stdout.trim().match(/:(\d+)$/)?.[1];

  if (!port) {
    throw new Error("Could not resolve the ephemeral PostgreSQL port.");
  }

  const environment = {
    ...process.env,
    APP_ENV: "test",
    DATABASE_URL: `postgresql://rails:rails@127.0.0.1:${port}/rails_test`,
    BETTER_AUTH_URL: "http://127.0.0.1:3100",
    BETTER_AUTH_SECRET: "rails-test-secret-value-not-for-production",
    GOOGLE_CLIENT_ID: "rails-test-google-client-id",
    GOOGLE_CLIENT_SECRET: "rails-test-google-client-secret",
    // The production `next start` build requires a Calendar token key. A fixed
    // 32-byte base64 key keeps the encrypted-token round trip deterministic in
    // e2e, mirroring how the auth secrets above are supplied to the test runtime.
    CALENDAR_TOKEN_KEY_VERSION: "1",
    CALENDAR_TOKEN_KEY_V1: "RrVgpBEL9NQ+Tp+tBN+nDqxjIh23DWae9xqqNf1XOwU=",
  };

  await runCommand("pnpm", ["db:migrate"], environment);
  await runCommand("pnpm", ["db:seed"], environment);
  await runCommand(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "src/server/task/repository.integration.test.ts",
      "src/server/focus/repository.integration.test.ts",
      "src/server/calendar/repository.integration.test.ts",
    ],
    environment,
  );
  await runCommand("pnpm", ["test:e2e"], environment);
} finally {
  await execFileAsync("docker", ["stop", containerName]).catch(() => undefined);
}
