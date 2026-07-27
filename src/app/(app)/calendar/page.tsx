import { headers } from "next/headers";

import { CalendarView } from "@/components/calendar/calendar-view";
import { getAccountSummary } from "@/server/auth/session";
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/domain/account/onboarding";

/**
 * The Calendar destination. The account's time zone and locale are resolved on
 * the server and handed to the client agenda, so the very first render already
 * knows how to place and format commitments. The auth/onboarding gate lives in
 * the surrounding layout; Calendar never requires Google access.
 */
export default async function CalendarPage() {
  const account = await getAccountSummary(await headers());

  return (
    <CalendarView
      locale={account?.locale ?? DEFAULT_LOCALE}
      timeZone={account?.timezone ?? DEFAULT_TIMEZONE}
    />
  );
}
