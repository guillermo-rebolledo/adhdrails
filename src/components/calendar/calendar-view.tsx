"use client";

import { useState } from "react";
import Link from "next/link";

import { weekBounds, weekDays } from "@/domain/calendar/agenda";
import { formatDayHeading } from "@/domain/calendar/format";
import { buttonVariants } from "@/components/ui/button";

import { LaterList } from "./later-list";
import { WeeklyAgenda } from "./weekly-agenda";

/**
 * The Calendar screen: a weekly agenda scoped to the current week plus a
 * separate Later list for everything beyond it. The reference instant is fixed
 * once on mount so the week doesn't shift mid-session. Everything renders in the
 * account's time zone and locale, and the whole screen works without Google
 * Calendar access.
 */
export function CalendarView({
  timeZone,
  locale,
}: {
  timeZone: string;
  locale: string;
}) {
  const [reference] = useState(() => new Date().toISOString());
  const bounds = weekBounds(reference, timeZone);
  const days = weekDays(reference, timeZone);
  const weekLabel = `${formatDayHeading(days[0], timeZone, locale)} – ${formatDayHeading(
    days[days.length - 1],
    timeZone,
    locale,
  )}`;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-pretty text-muted-foreground">
            Your week at a glance. Times follow your locale and time zone.
          </p>
        </div>
        <Link className={buttonVariants()} href="/calendar/events/new">
          New event
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">This week</h2>
        <p className="text-sm text-muted-foreground">{weekLabel}</p>
        <WeeklyAgenda
          locale={locale}
          reference={reference}
          timeZone={timeZone}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Later</h2>
        <LaterList from={bounds.endAt} locale={locale} timeZone={timeZone} />
      </div>
    </section>
  );
}
