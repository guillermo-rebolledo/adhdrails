import { describe, expect, it } from "vitest";

import { eventStatePresentation } from "./event-state";

describe("eventStatePresentation", () => {
  it("flags a local pending change before considering origin", () => {
    expect(
      eventStatePresentation({ origin: "local", syncState: "pending" }),
    ).toMatchObject({ kind: "pending", label: "Pending" });
  });

  it("keeps a conflicted change for review", () => {
    expect(
      eventStatePresentation({ origin: "local", syncState: "conflict" }),
    ).toMatchObject({ kind: "review" });
    expect(
      eventStatePresentation({ origin: "google", syncState: "failed" }),
    ).toMatchObject({ kind: "review" });
  });

  it("marks a synced Rails-owned event as local", () => {
    expect(
      eventStatePresentation({ origin: "local", syncState: "synced" }),
    ).toMatchObject({ kind: "local", label: "Local" });
  });

  it("marks a synced Google event as synchronized", () => {
    expect(
      eventStatePresentation({ origin: "google", syncState: "synced" }),
    ).toMatchObject({ kind: "synced", label: "Synced" });
  });

  it("distinguishes a stale Google mirror while it revalidates", () => {
    expect(
      eventStatePresentation({
        origin: "google",
        syncState: "synced",
        stale: true,
      }),
    ).toMatchObject({ kind: "stale", label: "Refreshing" });
  });
});
