import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import {
  hasCompletedOnboarding,
  resolveEffectiveTimeZone,
} from "@/domain/account/onboarding";
import { getAccountSummary } from "@/server/auth/session";

export default async function OnboardingPage() {
  const account = await getAccountSummary(await headers());

  if (!account) {
    redirect("/signin");
  }

  if (hasCompletedOnboarding(account)) {
    redirect("/today");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <OnboardingFlow
        accountName={account.name}
        initialTimezone={resolveEffectiveTimeZone(account.timezone)}
        initialLocale={account.locale}
      />
    </main>
  );
}
