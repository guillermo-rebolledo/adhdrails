import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { TimeZoneProvider } from "@/components/account/time-zone-provider";
import {
  DEFAULT_LOCALE,
  hasCompletedOnboarding,
  resolveProtectedRouteRedirect,
} from "@/domain/account/onboarding";
import { OfflineProvider } from "@/offline/provider";
import { getAccountSummary } from "@/server/auth/session";

/**
 * Gates every in-app destination. Anonymous requests go to sign-in and
 * signed-in-but-un-onboarded accounts go to onboarding. Google Calendar access
 * is never part of this decision, so an account that skipped Calendar setup
 * still reaches the full app.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const account = await getAccountSummary(await headers());

  const redirectTo = resolveProtectedRouteRedirect({
    authenticated: account !== null,
    onboarded: account ? hasCompletedOnboarding(account) : false,
  });

  if (redirectTo) {
    redirect(redirectTo);
  }

  return (
    <OfflineProvider accountId={account!.userId}>
      {/* Mounted once for every in-app destination, so every screen renders
          clock times in the same zone — and an account with no zone records the
          browser's exactly once, wherever the user happens to land first. */}
      <TimeZoneProvider
        accountTimeZone={account!.timezone}
        locale={account!.locale ?? DEFAULT_LOCALE}
      >
        <AppShell>{children}</AppShell>
      </TimeZoneProvider>
    </OfflineProvider>
  );
}
