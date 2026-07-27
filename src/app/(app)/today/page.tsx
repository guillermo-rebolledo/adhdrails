import { QuickCapture } from "@/components/inbox/quick-capture";

export default function TodayPage() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
        <p className="text-pretty text-muted-foreground">
          One clear place to see what matters now.
        </p>
      </div>
      <div className="rounded-xl border bg-card p-6 text-card-foreground">
        <QuickCapture />
        <p className="mt-3 text-xs text-muted-foreground">
          Captures are saved to your Inbox, online or off, and sync
          automatically.
        </p>
      </div>
    </section>
  );
}
