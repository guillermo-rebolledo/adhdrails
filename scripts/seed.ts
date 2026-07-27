import nextEnv from "@next/env";

import { createDatabaseConnection } from "../src/server/db/client";
import { seedRecords } from "../src/server/db/schema";
import {
  createSeedRecords,
  ensureSeedEnvironment,
} from "../src/server/db/seed";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());
ensureSeedEnvironment(process.env);

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const connection = createDatabaseConnection(databaseUrl);

try {
  await connection.database
    .insert(seedRecords)
    .values(createSeedRecords())
    .onConflictDoUpdate({
      target: seedRecords.id,
      set: { name: "walking-skeleton" },
    });
  console.log("Deterministic local/test seed completed.");
} finally {
  await connection.close();
}
