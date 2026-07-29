import { describe, expect, it } from "vitest";

import {
  ENERGY_SELECTION_TTL_MS,
  isEnergySelectionActive,
  resolveCurrentEnergy,
} from "./current-energy";

const SET_AT = "2026-07-27T14:00:00Z";

describe("current-energy expiry", () => {
  it("is active immediately after selection", () => {
    expect(
      isEnergySelectionActive({ energy: "low", setAt: SET_AT }, SET_AT),
    ).toBe(true);
  });

  it("stays active just before the ~3h window elapses", () => {
    const almost = new Date(
      Date.parse(SET_AT) + ENERGY_SELECTION_TTL_MS - 1_000,
    ).toISOString();
    expect(
      isEnergySelectionActive({ energy: "high", setAt: SET_AT }, almost),
    ).toBe(true);
  });

  it("expires once the window elapses", () => {
    const after = new Date(
      Date.parse(SET_AT) + ENERGY_SELECTION_TTL_MS,
    ).toISOString();
    expect(
      isEnergySelectionActive({ energy: "high", setAt: SET_AT }, after),
    ).toBe(false);
  });

  it("treats a selection from the future as inactive", () => {
    const before = new Date(Date.parse(SET_AT) - 1_000).toISOString();
    expect(
      isEnergySelectionActive({ energy: "medium", setAt: SET_AT }, before),
    ).toBe(false);
  });
});

describe("resolveCurrentEnergy", () => {
  it("returns null when there is no selection", () => {
    expect(resolveCurrentEnergy(null, SET_AT)).toBeNull();
  });

  it("returns the selected energy while it is active", () => {
    expect(
      resolveCurrentEnergy({ energy: "medium", setAt: SET_AT }, SET_AT),
    ).toBe("medium");
  });

  it("returns null once the selection has expired", () => {
    const after = new Date(
      Date.parse(SET_AT) + ENERGY_SELECTION_TTL_MS + 1,
    ).toISOString();
    expect(
      resolveCurrentEnergy({ energy: "medium", setAt: SET_AT }, after),
    ).toBeNull();
  });
});
