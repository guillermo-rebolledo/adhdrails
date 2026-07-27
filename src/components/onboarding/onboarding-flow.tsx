"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  deriveInitialLocale,
  deriveInitialTimeZone,
} from "@/domain/account/onboarding";

interface OnboardingFlowProps {
  accountName: string;
  initialTimezone: string;
  initialLocale: string;
}

type Step = "preferences" | "calendar";

// The browser's formatting settings are client-only data. Reading them through
// useSyncExternalStore keeps the server and first client render in agreement
// (no hydration mismatch) while still refining the values once mounted.
const noopSubscribe = () => () => {};

function useDetected(getClient: () => string, serverFallback: string): string {
  return useSyncExternalStore(noopSubscribe, getClient, () => serverFallback);
}

export function OnboardingFlow({
  accountName,
  initialTimezone,
  initialLocale,
}: OnboardingFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("preferences");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timezone = deriveInitialTimeZone(
    useDetected(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      initialTimezone,
    ),
  );
  const locale = deriveInitialLocale(
    useDetected(() => navigator.language, initialLocale),
  );

  const firstName = accountName.trim().split(/\s+/)[0] || "there";

  async function completeOnboarding(destination: "/today" | "/settings") {
    setIsPending(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/account/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone, locale }),
      });

      if (!response.ok) {
        throw new Error("Onboarding request failed");
      }

      router.push(destination);
      router.refresh();
    } catch {
      setIsPending(false);
      setError("Something went wrong finishing setup. Please try again.");
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-card-foreground shadow-sm">
      {step === "preferences" ? (
        <section aria-labelledby="onboarding-preferences-title">
          <h1
            id="onboarding-preferences-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Welcome, {firstName}
          </h1>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">
            Rails is ready. We&apos;ll show dates and times using the settings
            below — you can change them anytime in Settings.
          </p>

          <dl className="mt-6 grid grid-cols-1 gap-3">
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <dt className="text-sm text-muted-foreground">Time zone</dt>
              <dd className="text-sm font-medium">{timezone}</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <dt className="text-sm text-muted-foreground">
                Date &amp; time format
              </dt>
              <dd className="text-sm font-medium">{locale}</dd>
            </div>
          </dl>

          <Button
            className="mt-8 w-full"
            onClick={() => setStep("calendar")}
            type="button"
          >
            Continue
          </Button>
        </section>
      ) : (
        <section aria-labelledby="onboarding-calendar-title">
          <h1
            id="onboarding-calendar-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Google Calendar is optional
          </h1>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">
            You&apos;re signed in and ready to use Rails. Connecting Google
            Calendar is a separate, optional step — Rails works fully without
            it, and you can connect anytime from Settings.
          </p>

          <div className="mt-8 flex flex-col gap-3">
            <Button
              className="w-full"
              disabled={isPending}
              onClick={() => completeOnboarding("/today")}
              type="button"
            >
              {isPending ? "Finishing…" : "Skip for now — go to Today"}
            </Button>
            <Button
              className="w-full"
              disabled={isPending}
              onClick={() => completeOnboarding("/settings")}
              type="button"
              variant="outline"
            >
              Set up Calendar in Settings
            </Button>
          </div>

          {error ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="mt-6 text-xs text-muted-foreground underline-offset-4 hover:underline"
            disabled={isPending}
            onClick={() => setStep("preferences")}
            type="button"
          >
            Back
          </button>
        </section>
      )}
    </div>
  );
}
