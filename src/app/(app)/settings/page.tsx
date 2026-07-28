import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AccountSettingsForm } from "@/components/settings/account-settings-form";
import { CalendarSettings } from "@/components/settings/calendar-settings";
import { getAccountSummary } from "@/server/auth/session";
import { serializeConnection } from "@/server/calendar/http";
import { getCalendarService } from "@/server/calendar/service-factory";

export default async function SettingsPage() {
  const account = await getAccountSummary(await headers());

  if (!account) {
    redirect("/signin");
  }

  const connection = await getCalendarService().getConnection(account.userId);

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

      <Suspense>
        <CalendarSettings
          connection={connection ? serializeConnection(connection) : null}
          accountTimezone={account.timezone}
          accountLocale={account.locale}
        />
      </Suspense>
    </section>
  );
}
