import { TaskCreateForm } from "@/components/task/task-create-form";

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string }>;
}) {
  const { title } = await searchParams;

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">New task</h1>
        <p className="text-pretty text-muted-foreground">
          Capture the one thing you want to get done.
        </p>
      </div>
      <div className="rounded-xl border bg-card p-6 text-card-foreground">
        <TaskCreateForm initialTitle={title ?? ""} />
      </div>
    </section>
  );
}
