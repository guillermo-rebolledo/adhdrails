import { CalendarView } from "@/components/calendar/calendar-view";

/**
 * The Calendar destination. The time zone and locale come from the app-wide
 * `TimeZoneProvider` rather than this page, so Calendar can never disagree with
 * Today or Tasks about what hour an instant falls on. The auth/onboarding gate
 * lives in the surrounding layout; Calendar never requires Google access.
 */
export default function CalendarPage() {
  return <CalendarView />;
}
