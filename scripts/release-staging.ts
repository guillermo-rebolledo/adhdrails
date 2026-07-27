import { runCommand } from "./run-command";

const migrationEnvironment = {
  ...process.env,
  MIGRATION_PHASE: "expand",
};

await runCommand("pnpm", ["db:migrate"], migrationEnvironment);
await runCommand("pnpm", ["exec", "vercel", "deploy", "--target=staging"]);
