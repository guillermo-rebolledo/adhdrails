import { ThoughtForm } from "@/components/thoughts/thought-form";

export default async function EditThoughtPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Edit Thought</h1>
      <ThoughtForm thoughtId={id} />
    </section>
  );
}
