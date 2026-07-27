import { InboxList } from "@/components/inbox/inbox-list";

export default function InboxPage() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-pretty text-muted-foreground">
          Captured items wait here without pressure until you classify them.
        </p>
      </div>
      <InboxList />
    </section>
  );
}
