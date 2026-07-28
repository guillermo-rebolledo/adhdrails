import { headers } from "next/headers";
import Link from "next/link";

import { QuickCapture } from "@/components/inbox/quick-capture";
import { InAppReminderCues } from "@/components/notification/in-app-reminder-cues";
import { FocusNow } from "@/components/task/focus-now";
import { TaskList } from "@/components/task/task-list";
import { buttonVariants } from "@/components/ui/button";
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/domain/account/onboarding";
import { DEFAULT_REMINDER_PREFERENCES } from "@/domain/notification/reminder";
import { getAccountSummary } from "@/server/auth/session";
import { getNotificationRepository } from "@/server/notification/service-factory";

export default async function TodayPage() {
  const account = await getAccountSummary(await headers());
  const reminderPreferences = account
    ? await getNotificationRepository().getPreferences(account.userId)
    : DEFAULT_REMINDER_PREFERENCES;

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
        <p className="text-pretty text-muted-foreground">
          One clear place to see what matters now.
        </p>
      </div>
      <InAppReminderCues
        locale={account?.locale ?? DEFAULT_LOCALE}
        preferences={reminderPreferences}
        timeZone={account?.timezone ?? DEFAULT_TIMEZONE}
      />
      <div className="rounded-xl border bg-card p-6 text-card-foreground">
        <QuickCapture
          locale={account?.locale ?? DEFAULT_LOCALE}
          timeZone={account?.timezone ?? DEFAULT_TIMEZONE}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Captures are saved to your Inbox, online or off, and sync
          automatically.
        </p>
      </div>
      <FocusNow
        locale={account?.locale ?? DEFAULT_LOCALE}
        timeZone={account?.timezone ?? DEFAULT_TIMEZONE}
      />
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">Available tasks</h2>
          <Link
            className={buttonVariants({ size: "sm", variant: "outline" })}
            href="/tasks/new"
          >
            New task
          </Link>
        </div>
        <TaskList />
      </div>
    </section>
  );
}
