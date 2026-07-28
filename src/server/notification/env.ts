import type { WebPushConfig } from "./web-push-adapter";

export function webPushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

export function readWebPushConfig(): WebPushConfig {
  const subject = process.env.VAPID_SUBJECT?.trim();
  const publicKey = webPushPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!subject || !publicKey || !privateKey) {
    throw new Error(
      "VAPID_SUBJECT, VAPID_PUBLIC_KEY, and VAPID_PRIVATE_KEY are required for Web Push.",
    );
  }
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    throw new Error("VAPID_SUBJECT must be a mailto: or https: contact.");
  }
  return { subject, publicKey, privateKey };
}
