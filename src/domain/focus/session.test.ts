import { describe, expect, it } from "vitest";

import {
  applyFocusAction,
  elapsedSeconds,
  type FocusSessionState,
  isActiveFocusStatus,
  isFocusActionAllowed,
  resolveFocusStart,
  resolveFocusTransition,
  startFocusState,
  toTransitionRequest,
} from "./session";

const RESUMED = "2026-07-27T14:00:00.000Z";

function running(
  overrides: Partial<FocusSessionState> = {},
): FocusSessionState {
  return {
    status: "running",
    accumulatedSeconds: 0,
    lastResumedAt: RESUMED,
    completedAt: null,
    ...overrides,
  };
}

describe("elapsedSeconds", () => {
  it("counts up from the last resume while running", () => {
    const state = running({ accumulatedSeconds: 30 });
    // 90 seconds after the running segment began.
    expect(elapsedSeconds(state, "2026-07-27T14:01:30.000Z")).toBe(30 + 90);
  });

  it("freezes at the accumulated total while paused", () => {
    const state = running({
      status: "paused",
      accumulatedSeconds: 120,
      lastResumedAt: null,
    });
    expect(elapsedSeconds(state, "2026-07-27T15:00:00.000Z")).toBe(120);
  });

  it("never returns a negative elapsed under backward clock skew", () => {
    const state = running({ accumulatedSeconds: 10 });
    expect(elapsedSeconds(state, "2026-07-27T13:59:59.000Z")).toBe(10);
  });
});

describe("the focus state machine", () => {
  it("starts running with a fresh count-up segment", () => {
    const state = startFocusState(RESUMED);
    expect(state).toEqual({
      status: "running",
      accumulatedSeconds: 0,
      lastResumedAt: RESUMED,
      completedAt: null,
    });
    expect(isActiveFocusStatus(state.status)).toBe(true);
  });

  it("pausing folds the running segment into the accumulated total", () => {
    const paused = applyFocusAction(
      running({ accumulatedSeconds: 5 }),
      "pause",
      "2026-07-27T14:00:40.000Z",
    );
    expect(paused).toEqual({
      status: "paused",
      accumulatedSeconds: 45,
      lastResumedAt: null,
      completedAt: null,
    });
  });

  it("resuming keeps elapsed time and opens a new segment", () => {
    const paused = running({
      status: "paused",
      accumulatedSeconds: 45,
      lastResumedAt: null,
    });
    const resumed = applyFocusAction(
      paused,
      "resume",
      "2026-07-27T14:10:00.000Z",
    );
    expect(resumed).toEqual({
      status: "running",
      accumulatedSeconds: 45,
      lastResumedAt: "2026-07-27T14:10:00.000Z",
      completedAt: null,
    });
    // Elapsed keeps climbing from where it paused.
    expect(elapsedSeconds(resumed, "2026-07-27T14:10:15.000Z")).toBe(60);
  });

  it("completing folds the final segment and stamps completion", () => {
    const done = applyFocusAction(
      running({ accumulatedSeconds: 100 }),
      "complete",
      "2026-07-27T14:00:20.000Z",
    );
    expect(done).toEqual({
      status: "completed",
      accumulatedSeconds: 120,
      lastResumedAt: null,
      completedAt: "2026-07-27T14:00:20.000Z",
    });
    expect(isActiveFocusStatus(done.status)).toBe(false);
  });

  it("completing from paused keeps the frozen elapsed time", () => {
    const done = applyFocusAction(
      running({
        status: "paused",
        accumulatedSeconds: 300,
        lastResumedAt: null,
      }),
      "complete",
      "2026-07-27T16:00:00.000Z",
    );
    expect(done.accumulatedSeconds).toBe(300);
    expect(done.completedAt).toBe("2026-07-27T16:00:00.000Z");
  });

  it("allows only the legal transitions for each status", () => {
    expect(isFocusActionAllowed("running", "pause")).toBe(true);
    expect(isFocusActionAllowed("running", "resume")).toBe(false);
    expect(isFocusActionAllowed("running", "complete")).toBe(true);
    expect(isFocusActionAllowed("paused", "resume")).toBe(true);
    expect(isFocusActionAllowed("paused", "pause")).toBe(false);
    expect(isFocusActionAllowed("paused", "complete")).toBe(true);
    // Completion is terminal — nothing further is allowed.
    expect(isFocusActionAllowed("completed", "pause")).toBe(false);
    expect(isFocusActionAllowed("completed", "resume")).toBe(false);
    expect(isFocusActionAllowed("completed", "complete")).toBe(false);
  });

  it("refuses to apply an illegal transition", () => {
    expect(() =>
      applyFocusAction(running(), "resume", "2026-07-27T14:00:10.000Z"),
    ).toThrow(/cannot resume/i);
  });
});

describe("toTransitionRequest", () => {
  it("carries the absolute resulting state so offline transitions collapse cleanly", () => {
    const paused = applyFocusAction(
      running({ accumulatedSeconds: 5 }),
      "pause",
      "2026-07-27T14:00:40.000Z",
    );
    expect(toTransitionRequest(paused, 3, "key-x")).toEqual({
      idempotencyKey: "key-x",
      baseVersion: 3,
      status: "paused",
      accumulatedSeconds: 45,
      lastResumedAt: null,
      completedAt: null,
    });
  });
});

describe("resolveFocusStart", () => {
  const incoming = {
    id: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
  };

  it("inserts when no session is active", () => {
    expect(resolveFocusStart(null, incoming)).toBe("insert");
  });

  it("replays an idempotent retry of the same start", () => {
    expect(
      resolveFocusStart(
        { id: incoming.id, idempotencyKey: incoming.idempotencyKey },
        incoming,
      ),
    ).toBe("replay");
  });

  it("conflicts when a different active session already exists", () => {
    expect(
      resolveFocusStart(
        {
          id: "99999999-9999-4999-8999-999999999999",
          idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
        incoming,
      ),
    ).toBe("conflict");
  });
});

describe("resolveFocusTransition", () => {
  const incoming = { baseVersion: 2, idempotencyKey: "key-a" };

  it("reports a missing session", () => {
    expect(resolveFocusTransition(null, incoming)).toBe("missing");
  });

  it("replays a transition already applied", () => {
    expect(
      resolveFocusTransition(
        { version: 3, idempotencyKey: "key-a", status: "paused" },
        incoming,
      ),
    ).toBe("replay");
  });

  it("applies when the base version matches on an active session", () => {
    expect(
      resolveFocusTransition(
        { version: 2, idempotencyKey: "key-b", status: "running" },
        incoming,
      ),
    ).toBe("apply");
  });

  it("conflicts on a stale base version", () => {
    expect(
      resolveFocusTransition(
        { version: 5, idempotencyKey: "key-b", status: "running" },
        incoming,
      ),
    ).toBe("conflict");
  });

  it("conflicts against an already-completed session, whatever the version", () => {
    expect(
      resolveFocusTransition(
        { version: 2, idempotencyKey: "key-b", status: "completed" },
        incoming,
      ),
    ).toBe("conflict");
  });
});
