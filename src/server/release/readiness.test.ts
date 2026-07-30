import { describe, expect, it } from "vitest";

import {
  type ReadinessCheck,
  renderProductionReadinessReport,
  summarizeReadiness,
} from "./readiness";

const passing: ReadinessCheck = {
  name: "Seed safeguards",
  status: "pass",
  evidence: "Seeding rejected under APP_ENV=production.",
};
const manual: ReadinessCheck = {
  name: "OAuth verification",
  status: "manual",
  evidence: "Google OAuth verification is a human launch dependency.",
};
const failing: ReadinessCheck = {
  name: "Migration safety",
  status: "fail",
  evidence: "A non-expand migration is present.",
};

describe("summarizeReadiness", () => {
  it("reports ready only when every check passes", () => {
    const summary = summarizeReadiness([passing]);

    expect(summary).toMatchObject({
      overallStatus: "ready",
      hasFailures: false,
      hasManual: false,
      counts: { pass: 1, fail: 0, manual: 0 },
    });
  });

  it("is pending — not ready — while human launch dependencies remain", () => {
    const summary = summarizeReadiness([passing, manual]);

    expect(summary.overallStatus).toBe("pending");
    expect(summary.hasManual).toBe(true);
  });

  it("is blocked when any check fails", () => {
    const summary = summarizeReadiness([passing, manual, failing]);

    expect(summary.overallStatus).toBe("blocked");
    expect(summary.hasFailures).toBe(true);
  });

  it("treats an empty check set as not ready rather than vacuously ready", () => {
    expect(summarizeReadiness([]).overallStatus).toBe("blocked");
  });
});

describe("renderProductionReadinessReport", () => {
  it("records every check with its status and evidence", () => {
    const report = renderProductionReadinessReport({
      checks: [passing, manual],
      generatedAt: "2026-07-29T00:00:00.000Z",
    });

    expect(report).toContain("Seed safeguards");
    expect(report).toContain("Seeding rejected under APP_ENV=production.");
    expect(report).toContain("OAuth verification");
    expect(report).toContain("2026-07-29T00:00:00.000Z");
  });

  it("lists manual checks under remaining human launch dependencies", () => {
    const report = renderProductionReadinessReport({
      checks: [passing, manual],
      generatedAt: "2026-07-29T00:00:00.000Z",
    });

    const dependencies = report.slice(
      report.indexOf("Remaining human launch dependencies"),
    );
    expect(dependencies).toContain("OAuth verification");
    expect(dependencies).not.toContain("Seed safeguards");
  });

  it("never labels a failing report as ready for production", () => {
    const report = renderProductionReadinessReport({
      checks: [passing, failing],
      generatedAt: "2026-07-29T00:00:00.000Z",
    });

    expect(report).toContain("BLOCKED");
    expect(report).not.toMatch(/READY FOR PRODUCTION/i);
  });

  it("states there are no outstanding dependencies when all checks pass", () => {
    const report = renderProductionReadinessReport({
      checks: [passing],
      generatedAt: "2026-07-29T00:00:00.000Z",
    });

    expect(report).toContain("READY FOR PRODUCTION");
    expect(report).toMatch(/Remaining human launch dependencies[\s\S]*None/);
  });
});
