import { describe, expect, it } from "vitest";

import { createSeedRecords, ensureSeedEnvironment } from "./seed";

describe("database seed support", () => {
  it.each([
    {},
    { APP_ENV: "staging" },
    { APP_ENV: "production" },
    { APP_ENV: "local", NODE_ENV: "production" },
    { APP_ENV: "test", VERCEL_ENV: "production" },
  ])("refuses production-like environments: %o", (environment) => {
    expect(() => ensureSeedEnvironment(environment)).toThrow(
      "Database seeding is limited to explicit local or test environments.",
    );
  });

  it.each([{ APP_ENV: "local" }, { APP_ENV: "test" }])(
    "allows an explicit safe environment: %o",
    (environment) => {
      expect(() => ensureSeedEnvironment(environment)).not.toThrow();
    },
  );

  it("creates the same local fixture on every run", () => {
    const first = createSeedRecords();
    const second = createSeedRecords();

    expect(first).toEqual(second);
    expect(first).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "walking-skeleton",
      },
    ]);
  });
});
