import { describe, expect, it, vi } from "vitest";

import { DEFAULT_REMINDER_PREFERENCES } from "@/domain/notification/reminder";

import {
  createReminderDeliveryService,
  type ReminderCandidate,
} from "./reminder-service";

const NOW = new Date("2026-08-04T12:50:30.000Z");

function candidate(
  overrides: Partial<ReminderCandidate> = {},
): ReminderCandidate {
  return {
    userId: "user-1",
    timezone: "America/New_York",
    taskId: "11111111-1111-4111-8111-111111111111",
    scheduledDate: "2026-08-04",
    scheduledTime: "09:00",
    preferences: { ...DEFAULT_REMINDER_PREFERENCES, enabled: true },
    subscription: {
      id: "22222222-2222-4222-8222-222222222222",
      endpoint: "https://push.example/device-1",
      p256dh: "public-key",
      auth: "auth-secret",
    },
    ...overrides,
  };
}

function repository(candidates: ReminderCandidate[]) {
  return {
    listCandidates: vi.fn().mockResolvedValue(candidates),
    listRetries: vi.fn().mockResolvedValue([]),
    claimDelivery: vi.fn().mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      attempt: 1,
    }),
    completeDelivery: vi.fn().mockResolvedValue(undefined),
    failDelivery: vi.fn().mockResolvedValue(undefined),
    deleteSubscription: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ReminderDeliveryService", () => {
  it("never claims a delivery for a date-only Task", async () => {
    const repo = repository([candidate({ scheduledTime: null })]);
    const send = vi.fn();

    await createReminderDeliveryService(repo, { send }).run(NOW);

    expect(repo.claimDelivery).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("delivers independently to every browser with a redacted payload", async () => {
    const first = candidate();
    const second = candidate({
      subscription: {
        ...candidate().subscription,
        id: "44444444-4444-4444-8444-444444444444",
        endpoint: "https://push.example/device-2",
      },
    });
    const repo = repository([first, second]);
    const send = vi.fn().mockResolvedValue("sent");

    const result = await createReminderDeliveryService(repo, { send }).run(NOW);

    expect(result).toEqual({ delivered: 2, expired: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(
      first.subscription,
      JSON.stringify({
        kind: "timed-task",
        moment: "heads_up",
        href: "/today",
      }),
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain("Write the report");
  });

  it("removes only an expired device subscription", async () => {
    const item = candidate();
    const repo = repository([item]);
    const send = vi.fn().mockResolvedValue("expired");

    const result = await createReminderDeliveryService(repo, { send }).run(NOW);

    expect(result).toEqual({ delivered: 0, expired: 1, failed: 0 });
    expect(repo.deleteSubscription).toHaveBeenCalledWith(
      item.userId,
      item.subscription.id,
    );
    expect(repo.completeDelivery).toHaveBeenCalled();
  });

  it("records a retry without exposing provider details", async () => {
    const repo = repository([candidate()]);
    const send = vi.fn().mockRejectedValue(new Error("provider payload"));

    const result = await createReminderDeliveryService(repo, { send }).run(NOW);

    expect(result).toEqual({ delivered: 0, expired: 0, failed: 1 });
    expect(repo.failDelivery).toHaveBeenCalledWith(
      "user-1",
      "33333333-3333-4333-8333-333333333333",
      new Date("2026-08-04T12:52:30.000Z"),
      "push_unavailable",
    );
  });
});
