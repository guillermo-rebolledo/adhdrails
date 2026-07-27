import { createInterface } from "node:readline/promises";

import { runCommand } from "./run-command";
import { createNeonRestorePoint } from "../src/server/release/neon-snapshot";

const confirmation = "release Rails to production";
const prompt = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const answer = await prompt.question(
  `Type "${confirmation}" to continue with the production release: `,
);
prompt.close();

if (answer !== confirmation) {
  throw new Error("Production release canceled: confirmation did not match.");
}

await createNeonRestorePoint();
await runCommand("pnpm", ["db:migrate"], {
  ...process.env,
  MIGRATION_PHASE: "expand",
});
await runCommand("pnpm", ["exec", "vercel", "deploy", "--prod"]);
