import { InfoPage } from "@/components/info-page";

export default function TermsPage() {
  return (
    <InfoPage
      title="Terms"
      summary="Rails is a calm-focus productivity tool for independent adults."
    >
      <section>
        <h2 className="text-base font-medium">Product scope</h2>
        <p className="mt-2 text-muted-foreground">
          Rails helps organize tasks, thoughts, focus sessions, and calendar
          context. It is not a medical device, medical advice, or treatment.
        </p>
      </section>
      <section>
        <h2 className="text-base font-medium">Connected services</h2>
        <p className="mt-2 text-muted-foreground">
          Google identity is required for sign-in. Google Calendar access is
          optional, and Google remains authoritative for connected events.
        </p>
      </section>
      <section>
        <h2 className="text-base font-medium">MVP access</h2>
        <p className="mt-2 text-muted-foreground">
          The MVP is provided without ads, billing, or artificial usage limits
          while the product is validated.
        </p>
      </section>
    </InfoPage>
  );
}
