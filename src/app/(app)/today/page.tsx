import { headers } from "next/headers";

import { QuickCapture } from "@/components/inbox/quick-capture";
import { InAppReminderCues } from "@/components/notification/in-app-reminder-cues";
import { FocusNow } from "@/components/task/focus-now";
import {
  AvailableTasks,
  TodayOrientation,
} from "@/components/today/today-sections";
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/domain/account/onboarding";
import { DEFAULT_REMINDER_PREFERENCES } from "@/domain/notification/reminder";
import { getAccountSummary } from "@/server/auth/session";
import { getNotificationService } from "@/server/notification/service-factory";

export default async function TodayPage() {
  const account = await getAccountSummary(await headers());
  const reminderPreferences = account
    ? await getNotificationService().getPreferences(account.userId)
    : DEFAULT_REMINDER_PREFERENCES;

  const locale = account?.locale ?? DEFAULT_LOCALE;
  const timeZone = account?.timezone ?? DEFAULT_TIMEZONE;

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
        <p className="text-pretty text-muted-foreground">
          What to do now, and what to remember today.
        </p>
      </div>
      <InAppReminderCues
        locale={locale}
        preferences={reminderPreferences}
        timeZone={timeZone}
      />
      {/* The one protected primary action — capture — leads the page. */}
      <div className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <QuickCapture locale={locale} timeZone={timeZone} />
        <p className="mt-3 text-xs text-muted-foreground">
          Captures are saved to your Inbox, online or off, and sync
          automatically.
        </p>
      </div>
      {/* First-run only: names what Rails is for. Hides once there is work. */}
      <TodayOrientation />
      <FocusNow locale={locale} timeZone={timeZone} />
      {/* Low-emphasis: collapsed once populated so it never competes with the
          focus decision above. */}
      <AvailableTasks />
    </section>
  );
}
