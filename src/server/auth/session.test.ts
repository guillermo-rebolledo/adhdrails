import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("./index", () => ({
  getAuth: () => ({ api: { getSession } }),
}));

import { getAccountSummary } from "./session";

const user = {
  id: "user_1",
  email: "person@example.test",
  name: "Person",
  timezone: "UTC",
  locale: "en-US",
  onboardingCompletedAt: null,
  deletionRequestedAt: null,
};

describe("getAccountSummary", () => {
  beforeEach(() => getSession.mockReset());

  it("denies an existing session as soon as account deletion is requested", async () => {
    getSession.mockResolvedValue({
      user: {
        ...user,
        deletionRequestedAt: new Date("2026-07-28T12:00:00.000Z"),
      },
    });

    await expect(getAccountSummary(new Headers())).resolves.toBeNull();
  });

  it("returns the ownership scope for an active account", async () => {
    getSession.mockResolvedValue({ user });

    await expect(getAccountSummary(new Headers())).resolves.toMatchObject({
      userId: "user_1",
      email: "person@example.test",
    });
  });
});
