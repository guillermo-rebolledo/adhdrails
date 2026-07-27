import postgres from "postgres";

export async function checkDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Database connection is not configured");
  }

  const sql = postgres(databaseUrl, {
    connect_timeout: 5,
    max: 1,
    prepare: false,
  });

  try {
    await sql`select 1`;
  } finally {
    await sql.end();
  }
}
