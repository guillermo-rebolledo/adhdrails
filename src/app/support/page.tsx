import { InfoPage } from "@/components/info-page";

export default function SupportPage() {
  return (
    <InfoPage
      title="Support"
      summary="Tell us what happened and what you expected. You do not need to share the content of a Task, Thought, or Calendar event."
    >
      <section>
        <h2 className="text-base font-medium">Contact</h2>
        <p className="mt-2 text-muted-foreground">
          Email{" "}
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href="mailto:support@rails.app"
          >
            support@rails.app
          </a>
          . Include the page you were using, the approximate time, and any
          correlation ID shown with the error.
        </p>
      </section>
      <section>
        <h2 className="text-base font-medium">Privacy-safe diagnostics</h2>
        <p className="mt-2 text-muted-foreground">
          Rails support records operational metadata for sync, export, and
          deletion failures. Those records do not contain your Task or Thought
          content, Calendar payloads, tokens, or exported data.
        </p>
      </section>
    </InfoPage>
  );
}
