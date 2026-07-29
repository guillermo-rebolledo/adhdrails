import { describe, expect, it } from "vitest";

import {
  areaCreateRequestSchema,
  areaNamesMatch,
  normalizeAreaName,
  resolveCreate,
} from "./area";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

describe("areaNameSchema", () => {
  it("trims and accepts a non-empty name", () => {
    const parsed = areaCreateRequestSchema.parse({
      id: ID,
      name: "  Work  ",
      idempotencyKey: KEY,
    });

    expect(parsed.name).toBe("Work");
  });

  it("rejects an empty name", () => {
    expect(
      areaCreateRequestSchema.safeParse({
        id: ID,
        name: "   ",
        idempotencyKey: KEY,
      }).success,
    ).toBe(false);
  });
});

describe("name normalization", () => {
  it("ignores case and surrounding whitespace when matching", () => {
    expect(normalizeAreaName("  Work ")).toBe("work");
    expect(areaNamesMatch("Work", "  work  ")).toBe(true);
    expect(areaNamesMatch("Work", "Home")).toBe(false);
  });
});

describe("resolveCreate", () => {
  const incoming = { name: "Work", idempotencyKey: KEY };

  it("inserts when nothing is stored", () => {
    expect(resolveCreate(null, incoming)).toBe("insert");
  });

  it("replays a duplicate idempotency key", () => {
    expect(
      resolveCreate({ name: "Anything", idempotencyKey: KEY }, incoming),
    ).toBe("replay");
  });

  it("replays an equivalent name under a different key", () => {
    expect(
      resolveCreate({ name: "  work ", idempotencyKey: "other" }, incoming),
    ).toBe("replay");
  });

  it("conflicts on a divergent id collision", () => {
    expect(
      resolveCreate({ name: "Home", idempotencyKey: "other" }, incoming),
    ).toBe("conflict");
  });
});
