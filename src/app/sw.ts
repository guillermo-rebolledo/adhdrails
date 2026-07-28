/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

interface RailsPushPayload {
  kind: "timed-task" | "test";
  moment?: "heads_up" | "at_time";
  href: "/today" | "/settings";
}

function readPayload(event: PushEvent): RailsPushPayload | null {
  try {
    const value = event.data?.json() as Partial<RailsPushPayload> | undefined;
    if (
      !value ||
      (value.kind !== "timed-task" && value.kind !== "test") ||
      (value.href !== "/today" && value.href !== "/settings")
    ) {
      return null;
    }
    return value as RailsPushPayload;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  if (!payload) return;
  event.waitUntil(
    self.registration.showNotification(
      payload.kind === "test" ? "Rails test notification" : "Rails reminder",
      {
        body:
          payload.kind === "test"
            ? "Notifications are working on this browser."
            : payload.moment === "at_time"
              ? "A timed Task is ready now."
              : "A timed Task is coming up.",
        data: { href: payload.href },
        ...(payload.kind === "test" ? { tag: "rails-test-notification" } : {}),
      },
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href =
    (event.notification.data as { href?: unknown } | undefined)?.href ===
    "/settings"
      ? "/settings"
      : "/today";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const existing = clients.find(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        if (existing && "focus" in existing) {
          await existing.navigate(href);
          return existing.focus();
        }
        return self.clients.openWindow(href);
      }),
  );
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  disableDevLogs: true,
});

serwist.addEventListeners();
