import { EventCreateForm } from "@/components/calendar/event-create-form";

/**
 * The full-page local Event creation flow. Creation uses a dedicated page (not a
 * modal or drawer) so entry is reliable on small screens and with mobile
 * keyboards. The form seeds its zone from the app-wide clock.
 */
export default function NewEventPage() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">New event</h1>
        <p className="text-pretty text-muted-foreground">
          Add a timed event to your calendar. No Google Calendar access needed.
        </p>
      </div>
      <EventCreateForm />
    </section>
  );
}
