import { describe, expect, it } from "vitest";

import {
  MAINTENANCE_JOB_RETENTION_MS,
  RECONCILIATION_STALE_MS,
  maintenanceJobRetentionCutoff,
  reconciliationCutoff,
  reconciliationIsDue,
} from "./maintenance";

const NOW = new Date("2026-07-28T12:00:00.000Z");

describe("reconciliationIsDue", () => {
  it("is due when a calendar has never synced", () => {
    expect(reconciliationIsDue(null, NOW)).toBe(true);
  });

  it("is not due for a calendar synced within the staleness window", () => {
    const recent = new Date(NOW.getTime() - RECONCILIATION_STALE_MS + 60_000);
    expect(reconciliationIsDue(recent, NOW)).toBe(false);
  });

  it("is due once the last sync ages past the staleness cutoff", () => {
    const stale = new Date(NOW.getTime() - RECONCILIATION_STALE_MS - 60_000);
    expect(reconciliationIsDue(stale, NOW)).toBe(true);
  });

  it("treats a sync exactly at the cutoff as due", () => {
    const atCutoff = new Date(NOW.getTime() - RECONCILIATION_STALE_MS);
    expect(reconciliationIsDue(atCutoff, NOW)).toBe(true);
  });
});

describe("reconciliationCutoff", () => {
  it("is now minus the staleness window", () => {
    expect(reconciliationCutoff(NOW)).toEqual(
      new Date(NOW.getTime() - RECONCILIATION_STALE_MS),
    );
  });
});

describe("maintenanceJobRetentionCutoff", () => {
  it("is now minus the retention window", () => {
    expect(maintenanceJobRetentionCutoff(NOW)).toEqual(
      new Date(NOW.getTime() - MAINTENANCE_JOB_RETENTION_MS),
    );
  });
});
