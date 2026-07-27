import { headers } from "next/headers";
import Link from "next/link";
import { Temporal } from "temporal-polyfill";

import { TaskCollections } from "@/components/task/task-collections";
import { buttonVariants } from "@/components/ui/button";
import { DEFAULT_TIMEZONE } from "@/domain/account/onboarding";
import { getAccountSummary } from "@/server/auth/session";

export default async function TasksPage() {
  const account = await getAccountSummary(await headers());
  const timeZone = account?.timezone ?? DEFAULT_TIMEZONE;
  const today = Temporal.Now.zonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-pretty text-muted-foreground">
            Flexible work stays visible and easy to revisit.
          </p>
        </div>
        <Link className={buttonVariants()} href="/tasks/new">
          New task
        </Link>
      </div>
      <TaskCollections today={today} />
    </section>
  );
}
