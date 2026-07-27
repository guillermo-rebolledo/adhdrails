import { ThoughtDetail } from "@/components/thoughts/thought-detail";

export default async function ThoughtPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <section className="mx-auto max-w-2xl">
      <ThoughtDetail id={id} />
    </section>
  );
}
