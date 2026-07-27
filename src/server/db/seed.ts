type SeedEnvironment = Partial<
  Record<"APP_ENV" | "NODE_ENV" | "VERCEL_ENV", string>
>;

const deterministicSeedRecords = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "walking-skeleton",
  },
] as const;

export function ensureSeedEnvironment(environment: SeedEnvironment): void {
  const isAllowedAppEnvironment =
    environment.APP_ENV === "local" || environment.APP_ENV === "test";
  const isProductionRuntime =
    environment.NODE_ENV === "production" ||
    environment.VERCEL_ENV === "production";

  if (!isAllowedAppEnvironment || isProductionRuntime) {
    throw new Error(
      "Database seeding is limited to explicit local or test environments.",
    );
  }
}

export function createSeedRecords() {
  return deterministicSeedRecords.map((record) => ({ ...record }));
}
