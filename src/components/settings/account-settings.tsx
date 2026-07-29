"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

import { SETTINGS_SECTION_CLASS_NAME } from "./settings-section";

interface AccountSettingsProps {
  name: string;
  email: string;
}

export function AccountSettings({ name, email }: AccountSettingsProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    await authClient.signOut();
    router.push("/signin");
    router.refresh();
  }

  return (
    <section
      aria-labelledby="account-title"
      className={SETTINGS_SECTION_CLASS_NAME}
      id="account"
    >
      <h2 id="account-title" className="text-lg font-medium">
        Account
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your Google identity is used only to sign in to Rails.
      </p>
      <dl className="mt-5 grid gap-3 text-sm">
        <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:items-baseline">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{name}</dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:items-baseline">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="min-w-0 font-medium break-all">{email}</dd>
        </div>
      </dl>
      <Button
        className="mt-5"
        disabled={isSigningOut}
        onClick={signOut}
        type="button"
        variant="outline"
      >
        {isSigningOut ? "Signing out…" : "Sign out"}
      </Button>
    </section>
  );
}
