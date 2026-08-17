import Link from "next/link";

import { TaskCollections } from "@/components/task/task-collections";
import { buttonVariants } from "@/components/ui/button";

export default function TasksPage() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-pretty text-muted-foreground">
            Flexible work stays visible and easy to revisit.
          </p>
        </div>
        <Link className={buttonVariants()} href="/tasks/new">
          New task
        </Link>
      </div>
      <TaskCollections />
    </section>
  );
}
