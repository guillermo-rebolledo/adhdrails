import { Suspense } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountSettings } from "@/components/settings/account-settings";
import { AccountSettingsForm } from "@/components/settings/account-settings-form";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { CalendarSettings } from "@/components/settings/calendar-settings";
import { DataPrivacySettings } from "@/components/settings/data-privacy-settings";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { resolveEffectiveTimeZone } from "@/domain/account/onboarding";
import { SETTINGS_SECTION_CLASS_NAME } from "@/components/settings/settings-section";
import { getDataExportService } from "@/server/account/service-factory";
import { getAccountSummary } from "@/server/auth/session";
import { serializeConnection } from "@/server/calendar/http";
import { getCalendarService } from "@/server/calendar/service-factory";
import { webPushPublicKey } from "@/server/notification/env";
import { getNotificationService } from "@/server/notification/service-factory";

const settingsSections = [
  { id: "account", label: "Account" },
  { id: "calendars", label: "Calendars" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
  { id: "timezone", label: "Timezone" },
  { id: "data-privacy", label: "Data & Privacy" },
  { id: "about-support", label: "About & Support" },
] as const;

export default async function SettingsPage() {
  const account = await getAccountSummary(await headers());

  if (!account) {
    redirect("/signin");
  }

  const [connection, reminderPreferences, dataExportStatus] = await Promise.all(
    [
      getCalendarService().getConnection(account.userId),
      getNotificationService().getPreferences(account.userId),
      getDataExportService().getStatus(account.userId),
    ],
  );

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          Your workspace
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="max-w-2xl text-pretty text-muted-foreground">
          One place for your account, integrations, reminders, appearance,
          planning context, privacy, and support.
        </p>
      </header>

      <div className="grid items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          className="overflow-x-auto md:sticky md:top-6"
        >
          <ul className="flex min-w-max gap-1 pb-2 md:min-w-0 md:flex-col md:pb-0">
            {settingsSections.map((section) => (
              <li key={section.id}>
                <a
                  className="block rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  href={`#${section.id}`}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-5">
          <AccountSettings name={account.name} email={account.email} />

          <Suspense>
            <CalendarSettings
              connection={connection ? serializeConnection(connection) : null}
              accountTimezone={resolveEffectiveTimeZone(account.timezone)}
              accountLocale={account.locale}
            />
          </Suspense>

          <NotificationSettings
            initialPreferences={reminderPreferences}
            vapidPublicKey={webPushPublicKey()}
          />

          <AppearanceSettings />

          <AccountSettingsForm
            initialTimezone={resolveEffectiveTimeZone(account.timezone)}
            initialLocale={account.locale}
          />

          <DataPrivacySettings
            initialStatus={dataExportStatus}
            accountId={account.userId}
          />

          <section
            aria-labelledby="about-support-title"
            className={SETTINGS_SECTION_CLASS_NAME}
            id="about-support"
          >
            <h2 id="about-support-title" className="text-lg font-medium">
              About &amp; Support
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Rails is a calm-focus productivity tool for independent adults. It
              is not medical care or treatment.
            </p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
              <Link
                className="underline-offset-4 hover:underline"
                href="/support"
              >
                Contact support
              </Link>
              <Link
                className="underline-offset-4 hover:underline"
                href="/terms"
              >
                Terms
              </Link>
              <Link
                className="underline-offset-4 hover:underline"
                href="/privacy"
              >
                Privacy
              </Link>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
