import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AccountSettingsForm } from "@/components/settings/account-settings-form";
import { getAccountSummary } from "@/server/auth/session";

export default async function SettingsPage() {
  const account = await getAccountSummary(await headers());

  if (!account) {
    redirect("/signin");
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Control appearance, integrations, privacy, and support.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-6 text-card-foreground">
        <h2 className="text-lg font-medium">Account</h2>
        <dl className="mt-4 grid grid-cols-1 gap-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{account.name}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium">{account.email}</dd>
          </div>
        </dl>
      </div>

      <AccountSettingsForm
        initialTimezone={account.timezone}
        initialLocale={account.locale}
      />

      <div className="rounded-xl border bg-card p-6 text-card-foreground">
        <h2 className="text-lg font-medium">Google Calendar</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Google Calendar is optional and connected separately from sign-in.
          Connecting your calendar will be available here soon.
        </p>
      </div>
    </section>
  );
}
