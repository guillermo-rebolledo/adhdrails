import webPush from "web-push";

import type { PushAdapter, StoredPushSubscription } from "./reminder-service";

export interface WebPushConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

function statusCodeOf(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }
  return null;
}

export function createWebPushAdapter(config: WebPushConfig): PushAdapter {
  return {
    async send(subscription: StoredPushSubscription, payload: string) {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload,
          {
            TTL: 300,
            urgency: "normal",
            vapidDetails: config,
          },
        );
        return "sent";
      } catch (error) {
        const statusCode = statusCodeOf(error);
        if (statusCode === 404 || statusCode === 410) return "expired";
        // Provider bodies can contain sensitive endpoint information. Replace
        // them with a stable safe error before Inngest or logs see the failure.
        throw new Error("Web Push delivery failed.");
      }
    },
  };
}
