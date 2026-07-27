import { describe, expect, it } from "vitest";

import { validateExpandMigrations } from "./migrations";

const unsafeMigrationCases: Array<{
  migrations: Array<{ name: string; contents: string }>;
}> = [
  { migrations: [] },
  {
    migrations: [
      { name: "0001_unlabelled.sql", contents: "DROP TABLE example;" },
    ],
  },
  {
    migrations: [
      {
        name: "0002_contract.sql",
        contents: "-- migration-phase: contract\nDROP COLUMN example.old;",
      },
    ],
  },
];

describe("expand-contract migration safety", () => {
  it("accepts migrations explicitly labelled expand", () => {
    expect(() =>
      validateExpandMigrations([
        {
          name: "0000_initial.sql",
          contents: "-- migration-phase: expand\nCREATE TABLE example ();",
        },
      ]),
    ).not.toThrow();
  });

  it.each(unsafeMigrationCases)(
    "fails closed for an unsafe migration set: %o",
    ({ migrations }) => {
      expect(() => validateExpandMigrations(migrations)).toThrow(
        "Only explicitly labelled expand migrations may run automatically.",
      );
    },
  );
});
