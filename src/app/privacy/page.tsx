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
          removing your Rails login. Browser reminder subscriptions are managed
          separately on each device.
        </p>
      </section>
    </InfoPage>
  );
}
