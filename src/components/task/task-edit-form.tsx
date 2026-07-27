"use client";

import { type FormEvent, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TASK_TITLE_MAX_LENGTH } from "@/domain/task/task";
import { updateTask } from "@/offline/task-commands";
import { useOffline } from "@/offline/provider";

/**
 * The dedicated full-page Task edit flow. It reads the Task straight from the
 * local replica, so viewing and editing work online or offline. Saving queues
 * an optimistic update through the same Dexie-first boundary as every other
 * mutation.
 */
export function TaskEditForm({ taskId }: { taskId: string }) {
  const { db, sync } = useOffline();
  const router = useRouter();
  const inputId = useId();
  // Map a missing row to null so it is distinguishable from the loading state
  // (both of which Dexie would otherwise report as undefined).
  const task = useLiveQuery(
    async () => (await db.tasks.get(taskId)) ?? null,
    [db, taskId],
  );
  // `null` means "untouched": show the loaded Task's title until the user edits.
  const [edited, setEdited] = useState<string | null>(null);

  if (task === undefined) {
    return null;
  }

  if (task === null || task.deletedAt !== null) {
    return (
      <p className="text-muted-foreground">This task is no longer available.</p>
    );
  }

  const currentTitle = task.title;
  const title = edited ?? currentTitle;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "") {
      return;
    }
    if (trimmed !== currentTitle) {
      await updateTask(db, taskId, { title: trimmed });
      void sync();
    }
    router.push("/today");
  }

  return (
    <form
      aria-label="Edit task"
      className="flex flex-col gap-4"
      onSubmit={onSubmit}
    >
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={inputId}>
          Task title
        </label>
        <Input
          autoComplete="off"
          id={inputId}
          maxLength={TASK_TITLE_MAX_LENGTH}
          name="title"
          onChange={(event) => setEdited(event.target.value)}
          value={title}
        />
      </div>
      <div className="flex gap-2">
        <Button disabled={title.trim() === ""} type="submit">
          Save changes
        </Button>
        <Link className={buttonVariants({ variant: "ghost" })} href="/today">
          Cancel
        </Link>
      </div>
    </form>
  );
}
