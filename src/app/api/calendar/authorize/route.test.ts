import { describe, expect, it, vi } from "vitest";

import type { CalendarService } from "@/server/calendar/service";
import { STATE_COOKIE } from "@/server/calendar/oauth-state";

import { createAuthorizeRouteHandler } from "./route";

function service(url: string): CalendarService {
  return {
    buildAuthorizationUrl: vi.fn().mockReturnValue(url),
  } as unknown as CalendarService;
}

describe("GET /api/calendar/authorize", () => {
  it("redirects an unauthenticated visitor to sign-in", async () => {
    const GET = createAuthorizeRouteHandler({
      getAccountSummary: vi.fn().mockResolvedValue(null),
      getService: () => service("https://google/consent"),
      createState: () => "state-1",
    });

    const response = await GET(
      new Request("https://rails.example/api/calendar/authorize"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://rails.example/signin",
    );
  });

  it("redirects to Google with a CSRF state cookie", async () => {
    const buildAuthorizationUrl = vi
      .fn()
      .mockReturnValue("https://google/consent?state=state-1");
    const GET = createAuthorizeRouteHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () =>
        ({ buildAuthorizationUrl }) as unknown as CalendarService,
      createState: () => "state-1",
    });

    const response = await GET(
      new Request("https://rails.example/api/calendar/authorize?return=/today"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://google/consent?state=state-1",
    );
    expect(buildAuthorizationUrl).toHaveBeenCalledWith("state-1");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${STATE_COOKIE}=state-1`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("marks cookies Secure over https", async () => {
    const GET = createAuthorizeRouteHandler({
      getAccountSummary: vi.fn().mockResolvedValue({ userId: "u1" }),
      getService: () => service("https://google/consent"),
      createState: () => "state-1",
    });

    const response = await GET(
      new Request("https://rails.example/api/calendar/authorize"),
    );

    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
});
