import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_TOMBSTONE_TTL_MS,
  OPERATIONAL_AUDIT_TTL_MS,
  accountDeletionRequestSchema,
  retentionDeadline,
} from "./deletion";

describe("account deletion", () => {
  it("requires the exact typed confirmation", () => {
    expect(
      accountDeletionRequestSchema.safeParse({
        confirmation: ACCOUNT_DELETION_CONFIRMATION,
      }).success,
    ).toBe(true);
    expect(
      accountDeletionRequestSchema.safeParse({ confirmation: "delete" })
        .success,
    ).toBe(false);
  });

  it("keeps deletion tombstones for 30 days and audit metadata for 90 days", () => {
    const requestedAt = new Date("2026-07-28T12:00:00.000Z");

    expect(
      retentionDeadline(
        requestedAt,
        ACCOUNT_DELETION_TOMBSTONE_TTL_MS,
      ).toISOString(),
    ).toBe("2026-08-27T12:00:00.000Z");
    expect(
      retentionDeadline(requestedAt, OPERATIONAL_AUDIT_TTL_MS).toISOString(),
    ).toBe("2026-10-26T12:00:00.000Z");
  });
});
