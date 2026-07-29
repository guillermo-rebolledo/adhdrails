"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { AccountDeletionStatusResponse } from "@/domain/account/deletion";
import { apiRequest } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

export function SignInForm({
  deletionConfirmed = false,
  deletionReceipt,
}: {
  deletionConfirmed?: boolean;
  deletionReceipt?: string;
}) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletionStatus, setDeletionStatus] =
    useState<AccountDeletionStatusResponse | null>(null);

  useEffect(() => {
    if (!deletionConfirmed || !deletionReceipt) {
      return;
    }

    let active = true;
    async function refresh() {
      const response = await apiRequest<AccountDeletionStatusResponse>(
        `/api/v1/account/deletion/${encodeURIComponent(deletionReceipt!)}`,
      ).catch(() => null);
      if (active && response?.ok && response.body) {
        setDeletionStatus(response.body);
        if (response.body.status === "completed") {
          clearInterval(timer);
        }
      }
    }

    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [deletionConfirmed, deletionReceipt]);

  async function signInWithGoogle() {
    setIsPending(true);
    setError(null);

    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/today",
    });

    if (error) {
      setIsPending(false);
      setError("We couldn't start Google sign-in. Please try again.");
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-card-foreground shadow-sm">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome to Rails
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          Calm focus for the work that matters now. Sign in with Google to begin
          — no new password to remember.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {deletionConfirmed ? (
          <p
            className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground"
            role="status"
          >
            {deletionStatus?.status === "completed"
              ? "Your account and Rails content have been permanently deleted."
              : deletionStatus?.status === "failed"
                ? "Your account remains disabled while Rails safely retries permanent cleanup."
                : "Your account deletion was confirmed. Rails has signed you out and is completing the permanent cleanup."}
          </p>
        ) : null}
        <Button
          className="w-full"
          disabled={isPending}
          onClick={signInWithGoogle}
          type="button"
        >
          {isPending ? "Starting Google sign-in…" : "Continue with Google"}
        </Button>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Google Calendar access is optional and requested separately, never as a
        condition of signing in.
      </p>
    </div>
  );
}
