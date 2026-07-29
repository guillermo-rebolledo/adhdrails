import { UMAMI_SCRIPT_SRC } from "@/domain/analytics/events";

export interface AnalyticsConfig {
  websiteId: string;
  scriptSrc: string;
}

/**
 * Resolves the browser analytics configuration from public environment. Returns
 * `null` — analytics disabled — whenever the website id is absent, so local and
 * preview environments never report into the production Umami property. The
 * script source is pinned to the US Umami host and is not environment-tunable,
 * so analytics can never be pointed at a non-US region by misconfiguration.
 */
export function resolveAnalyticsConfig(
  env: {
    NEXT_PUBLIC_UMAMI_WEBSITE_ID?: string;
  } = {
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
  },
): AnalyticsConfig | null {
  const websiteId = env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim();
  if (!websiteId) {
    return null;
  }

  return { websiteId, scriptSrc: UMAMI_SCRIPT_SRC };
}
