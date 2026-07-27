import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

type MigrationSource = {
  name: string;
  contents: string;
};

const EXPAND_HEADER = "-- migration-phase: expand";

export function validateExpandMigrations(
  migrations: readonly MigrationSource[],
): void {
  if (
    migrations.length === 0 ||
    migrations.some(
      ({ contents }) => contents.split(/\r?\n/, 1)[0] !== EXPAND_HEADER,
    )
  ) {
    throw new Error(
      "Only explicitly labelled expand migrations may run automatically.",
    );
  }
}

export async function assertExpandOnlyMigrations(
  migrationsFolder: string,
): Promise<void> {
  const filenames = (await readdir(migrationsFolder))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const migrations = await Promise.all(
    filenames.map(async (name) => ({
      name,
      contents: await readFile(path.join(migrationsFolder, name), "utf8"),
    })),
  );

  validateExpandMigrations(migrations);
}
