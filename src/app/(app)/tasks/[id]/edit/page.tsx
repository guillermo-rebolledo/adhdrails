import { TaskEditForm } from "@/components/task/task-edit-form";

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Edit task</h1>
        <p className="text-pretty text-muted-foreground">
          Adjust the details. Changes save the moment you do.
        </p>
      </div>
      <div className="rounded-xl border bg-card p-6 text-card-foreground">
        <TaskEditForm taskId={id} />
      </div>
    </section>
  );
}
