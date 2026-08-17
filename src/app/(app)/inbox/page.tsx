import { InboxList } from "@/components/inbox/inbox-list";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const { item } = await searchParams;

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-pretty text-muted-foreground">
          Process items one at a time, at your own pace. Nothing here is
          overdue, and there is no Inbox Zero to reach.
        </p>
      </div>
      <InboxList highlightedItemId={item} />
    </section>
  );
}
