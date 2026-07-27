"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

interface AccountSettingsFormProps {
  initialTimezone: string;
  initialLocale: string;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

export function AccountSettingsForm({
  initialTimezone,
  initialLocale,
}: AccountSettingsFormProps) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(initialTimezone);
  const [locale, setLocale] = useState(initialLocale);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSave({ status: "saving" });

    const response = await fetch("/api/v1/account", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone, locale }),
    });

    if (response.ok) {
      setSave({ status: "saved" });
      return;
    }

    setSave({
      status: "error",
      message:
        response.status === 422
          ? "Please enter a valid IANA time zone and locale."
          : "We couldn't save your changes. Please try again.",
    });
  }

  async function signOut() {
    setIsSigningOut(true);
    await authClient.signOut();
    router.push("/signin");
    router.refresh();
  }

  return (
    <form
      className="rounded-xl border bg-card p-6 text-card-foreground"
      onSubmit={onSubmit}
    >
      <h2 className="text-lg font-medium">Timezone &amp; formatting</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Interface copy stays in English while dates and times follow these
        settings.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Time zone</span>
          <Input
            autoComplete="off"
            name="timezone"
            onChange={(event) => setTimezone(event.target.value)}
            value={timezone}
          />
          <span className="text-xs text-muted-foreground">
            IANA identifier, e.g. America/New_York.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Date &amp; time format</span>
          <Input
            autoComplete="off"
            name="locale"
            onChange={(event) => setLocale(event.target.value)}
            value={locale}
          />
          <span className="text-xs text-muted-foreground">
            BCP 47 locale, e.g. en-US.
          </span>
        </label>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button disabled={save.status === "saving"} type="submit">
          {save.status === "saving" ? "Saving…" : "Save changes"}
        </Button>
        <Button
          disabled={isSigningOut}
          onClick={signOut}
          type="button"
          variant="ghost"
        >
          Sign out
        </Button>
        {save.status === "saved" ? (
          <span className="text-sm text-muted-foreground" role="status">
            Saved.
          </span>
        ) : null}
      </div>

      {save.status === "error" ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {save.message}
        </p>
      ) : null}
    </form>
  );
}
