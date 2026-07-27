import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let cached: { database: Database; url: string } | null = null;

/**
 * A process-wide database handle for request-time reads and writes. Scripts and
 * tests that need an isolated, disposable connection use
 * {@link createDatabaseConnection} instead.
 */
export function getDatabase(): Database {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (cached && cached.url === url) {
    return cached.database;
  }

  const client = postgres(url, { prepare: false });
  const database = drizzle(client, { schema });
  cached = { database, url };

  return database;
}
