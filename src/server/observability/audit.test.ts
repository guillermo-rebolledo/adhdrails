import { describe, expect, it } from "vitest";

import { operationalAuditValues, pseudonymousAccountReference } from "./audit";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("operational audit pseudonym", () => {
  it("derives a stable UUID-shaped reference for one account", () => {
    const a = pseudonymousAccountReference("user_1", "secret");
    const b = pseudonymousAccountReference("user_1", "secret");

    expect(a).toBe(b);
    expect(a).toMatch(UUID);
  });

  it("derives different references for different accounts", () => {
    expect(pseudonymousAccountReference("user_1", "secret")).not.toBe(
      pseudonymousAccountReference("user_2", "secret"),
    );
  });

  it("never returns the raw account id", () => {
    expect(pseudonymousAccountReference("user_1", "secret")).not.toContain(
      "user_1",
    );
  });
});

describe("operationalAuditValues", () => {
  it("stores only redacted metadata and a 90-day purge time", () => {
    const at = new Date("2026-07-28T00:00:00.000Z");
    const row = operationalAuditValues({
      userId: "user_1",
      action: "calendar.incremental_synced",
      target: "job-9",
      outcome: "success",
      correlationId: "cor_1",
      at,
    });

    expect(row.accountReference).toMatch(UUID);
    expect(row.accountReference).not.toBe("user_1");
    expect(row.action).toBe("calendar.incremental_synced");
    expect(row.opaqueTarget).toBe("job-9");
    expect(row.outcome).toBe("success");
    expect(row.correlationId).toBe("cor_1");
    expect(row.purgeAfter.getTime() - at.getTime()).toBe(
      90 * 24 * 60 * 60 * 1000,
    );
    // No content-bearing fields exist on the row at all.
    expect(Object.keys(row).sort()).toEqual(
      [
        "accountReference",
        "action",
        "correlationId",
        "id",
        "occurredAt",
        "opaqueTarget",
        "outcome",
        "purgeAfter",
        "safeCode",
      ].sort(),
    );
  });
});
