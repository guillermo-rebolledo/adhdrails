import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/sign-in-form";
import {
  hasCompletedOnboarding,
  resolveAuthenticatedLanding,
} from "@/domain/account/onboarding";
import { getAccountSummary } from "@/server/auth/session";

export default async function SignInPage() {
  const account = await getAccountSummary(await headers());

  const landing = resolveAuthenticatedLanding({
    authenticated: account !== null,
    onboarded: account ? hasCompletedOnboarding(account) : false,
  });

  if (landing) {
    redirect(landing);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <SignInForm />
    </main>
  );
}
