import { InfoPage } from "@/components/info-page";

export default function PrivacyPage() {
  return (
    <InfoPage
      title="Privacy"
      summary="Rails is designed to help you plan without turning personal content into product analytics."
    >
      <section>
        <h2 className="text-base font-medium">What Rails stores</h2>
        <p className="mt-2 text-muted-foreground">
          Rails stores the account preferences and app-owned content needed to
          provide the product. Connected Google Calendar events remain
          Google-owned data and are mirrored only to provide agenda, search, and
          offline behavior.
        </p>
      </section>
      <section>
        <h2 className="text-base font-medium">Measurement</h2>
        <p className="mt-2 text-muted-foreground">
          Product analytics exclude user-authored content, Calendar details,
          sensitive URLs, tokens, and session replay.
        </p>
      </section>
      <section>
        <h2 className="text-base font-medium">Your choices</h2>
        <p className="mt-2 text-muted-foreground">
          Google Calendar access is optional and can be disconnected without
          removing your Rails login. You can export app-owned data as JSON and
          permanently delete your Rails account from Settings. Browser reminder
          subscriptions are managed separately on each device.
        </p>
      </section>
      <section>
        <h2 className="text-base font-medium">Account deletion</h2>
        <p className="mt-2 text-muted-foreground">
          After Rails accepts a deletion request, account access is disabled
          immediately. Rails then revokes connected Google access, stops
          Calendar watches and reminders, clears queued work, and removes active
          app-owned data. A pseudonymous deletion receipt is kept for up to 30
          days so cleanup can be retried safely. Content-free operational audit
          metadata is pseudonymized immediately and kept for up to 90 days.
        </p>
      </section>
    </InfoPage>
  );
}
