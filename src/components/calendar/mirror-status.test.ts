import { describe, expect, it } from "vitest";

import { mirrorStatusLabel } from "./mirror-status";

const base = {
  isSyncing: false,
  isError: false,
  lastSyncedAt: null as string | null,
  timeZone: "America/New_York",
  locale: "en-US",
};

describe("mirrorStatusLabel", () => {
  it("announces a refresh in progress", () => {
    expect(mirrorStatusLabel({ ...base, isSyncing: true })).toBe(
      "Refreshing calendar…",
    );
  });

  it("reports an unavailable sync", () => {
    expect(mirrorStatusLabel({ ...base, isError: true })).toBe(
      "Calendar sync is unavailable right now.",
    );
  });

  it("shows the last-synced time when known", () => {
    const label = mirrorStatusLabel({
      ...base,
      lastSyncedAt: "2026-07-27T13:00:00.000Z",
    });
    expect(label).toContain("Last synced");
    expect(label).toContain("9:00");
  });

  it("shows nothing when Calendar is not connected", () => {
    expect(mirrorStatusLabel(base)).toBeNull();
  });

  it("prefers the refreshing state over a prior sync time", () => {
    expect(
      mirrorStatusLabel({
        ...base,
        isSyncing: true,
        lastSyncedAt: "2026-07-27T13:00:00.000Z",
      }),
    ).toBe("Refreshing calendar…");
  });
});
