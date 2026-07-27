import nextEnv from "@next/env";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabaseConnection } from "../src/server/db/client";
import { assertExpandOnlyMigrations } from "../src/server/release/migrations";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

if (
  (process.env.APP_ENV === "production" ||
    process.env.VERCEL_ENV === "production") &&
  process.env.MIGRATION_PHASE !== "expand"
) {
  throw new Error(
    "Production migrations require MIGRATION_PHASE=expand. Contract migrations must ship separately.",
  );
}

const connection = createDatabaseConnection(databaseUrl);

try {
  await assertExpandOnlyMigrations("./drizzle");
  await migrate(connection.database, {
    migrationsFolder: "./drizzle",
  });
  console.log("Expand-compatible database migrations completed.");
} finally {
  await connection.close();
}
