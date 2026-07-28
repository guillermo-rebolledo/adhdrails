import { describe, expect, it, vi } from "vitest";

import type { CalendarService } from "@/server/calendar/service";
import { RETURN_COOKIE, STATE_COOKIE } from "@/server/calendar/oauth-state";

import { createCallbackRouteHandler } from "./route";

function service(overrides: Partial<CalendarService> = {}): CalendarService {
  return {
    completeAuthorization: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as unknown as CalendarService;
}

function callback(
  params: Record<string, string>,
  cookies: Record<string, string> = {},
): Request {
  const url = new URL("https://rails.example/api/calendar/callback");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new Request(url, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

const deps = (
  overrides: Partial<Parameters<typeof createCallbackRouteHandler>[0]> = {},
) => ({
  getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
  getService: () => service(),
  createCorrelationId: () => "cor_1",
  ...overrides,
});

describe("GET /api/calendar/callback", () => {
  it("redirects to sign-in when unauthenticated", async () => {
    const GET = createCallbackRouteHandler(
      deps({ getAccountSummary: vi.fn().mockResolvedValue(null) }),
    );

    const response = await GET(callback({ code: "c", state: "s" }));
    expect(response.headers.get("location")).toBe(
      "https://rails.example/signin",
    );
  });

  it("returns to the saved path with a denied cue when the user declines", async () => {
    const GET = createCallbackRouteHandler(deps());

    const response = await GET(
      callback({ error: "access_denied" }, { [RETURN_COOKIE]: "/today" }),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/today");
    expect(location.searchParams.get("calendar")).toBe("denied");
  });

  it("rejects a state that does not match its cookie", async () => {
    const completeAuthorization = vi.fn();
    const GET = createCallbackRouteHandler(
      deps({ getService: () => service({ completeAuthorization }) }),
    );

    const response = await GET(
      callback(
        { code: "c", state: "attacker" },
        { [STATE_COOKIE]: "real", [RETURN_COOKIE]: "/settings" },
      ),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("calendar")).toBe("error");
    expect(completeAuthorization).not.toHaveBeenCalled();
  });

  it("completes authorization and clears the state cookies on success", async () => {
    const completeAuthorization = vi.fn().mockResolvedValue({ ok: true });
    const GET = createCallbackRouteHandler(
      deps({ getService: () => service({ completeAuthorization }) }),
    );

    const response = await GET(
      callback(
        { code: "auth-code", state: "match" },
        { [STATE_COOKIE]: "match", [RETURN_COOKIE]: "/settings" },
      ),
    );

    expect(completeAuthorization).toHaveBeenCalledWith("u1", "auth-code");
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/settings");
    expect(location.searchParams.get("calendar")).toBe("connected");
    expect(response.headers.get("set-cookie")).toContain(`${STATE_COOKIE}=;`);
  });

  it("surfaces an error cue when the exchange fails", async () => {
    const completeAuthorization = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "exchange_failed" });
    const GET = createCallbackRouteHandler(
      deps({ getService: () => service({ completeAuthorization }) }),
    );

    const response = await GET(
      callback({ code: "c", state: "match" }, { [STATE_COOKIE]: "match" }),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("calendar")).toBe("error");
  });
});
