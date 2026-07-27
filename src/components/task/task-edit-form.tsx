"use client";

import { type FormEvent, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import { AreaCombobox } from "@/components/task/area-combobox";
import {
  metadataToPlanningInput,
  type TaskMetadataDraft,
  TaskPlanningFields,
} from "@/components/task/task-planning-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TASK_TITLE_MAX_LENGTH, type TaskPatch } from "@/domain/task/task";
import type { LocalTask } from "@/offline/db";
import { updateTask } from "@/offline/task-commands";
import { useOffline } from "@/offline/provider";

/** The current Task, projected into the string-based form draft shape. */
function draftFromTask(task: LocalTask): TaskMetadataDraft {
  return {
    scheduledDate: task.scheduledDate ?? "",
    scheduledTime: task.scheduledTime ?? "",
    estimateMinutes: task.estimateMinutes?.toString() ?? "",
    energy: task.energy ?? "",
    important: task.important,
    notes: task.notes,
    areaId: task.areaId,
  };
}

/**
 * Builds the patch of only the fields that actually changed, so an edit that
 * touches one detail does not needlessly rewrite the rest. Planning fields are
 * included as `null` when cleared. Returns an empty object when nothing changed.
 */
function buildPatch(task: LocalTask, title: string, draft: TaskMetadataDraft) {
  const next = metadataToPlanningInput(draft);
  const patch: TaskPatch = {};

  if (title !== task.title) patch.title = title;
  if ((next.scheduledDate ?? null) !== task.scheduledDate) {
    patch.scheduledDate = next.scheduledDate ?? null;
  }
  if ((next.scheduledTime ?? null) !== task.scheduledTime) {
    patch.scheduledTime = next.scheduledTime ?? null;
  }
  if ((next.estimateMinutes ?? null) !== task.estimateMinutes) {
    patch.estimateMinutes = next.estimateMinutes ?? null;
  }
  if ((next.energy ?? null) !== task.energy) {
    patch.energy = next.energy ?? null;
  }
  if (next.important !== task.important) patch.important = next.important;
  if ((next.notes ?? "") !== task.notes) patch.notes = next.notes ?? "";
  if ((next.areaId ?? null) !== task.areaId) {
    patch.areaId = next.areaId ?? null;
  }

  return patch;
}

/**
 * The dedicated full-page Task edit flow. It reads the Task straight from the
 * local replica, so viewing and editing work online or offline, and edits every
 * field of planning metadata alongside the title. Saving queues an optimistic
 * update carrying only the changed fields through the same Dexie-first boundary
 * as every other mutation.
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
  // `null` means "untouched": show the loaded Task's values until the user edits.
  const [editedTitle, setEditedTitle] = useState<string | null>(null);
  const [editedMetadata, setEditedMetadata] =
    useState<TaskMetadataDraft | null>(null);

  if (task === undefined) {
    return null;
  }

  if (task === null || task.deletedAt !== null) {
    return (
      <p className="text-muted-foreground">This task is no longer available.</p>
    );
  }

  const currentTitle = task.title;
  const title = editedTitle ?? currentTitle;
  const metadata = editedMetadata ?? draftFromTask(task);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (task === undefined || task === null) {
      return;
    }
    const trimmed = title.trim();
    if (trimmed === "") {
      return;
    }

    const patch = buildPatch(task, trimmed, metadata);
    if (Object.keys(patch).length > 0) {
      await updateTask(db, taskId, patch);
      void sync();
    }
    router.push("/today");
  }

  return (
    <form
      aria-label="Edit task"
      className="flex flex-col gap-6"
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
          onChange={(event) => setEditedTitle(event.target.value)}
          value={title}
        />
      </div>

      <TaskPlanningFields
        onChange={setEditedMetadata}
        renderAreaField={(areaInputId) => (
          <AreaCombobox
            id={areaInputId}
            onValueChange={(areaId) =>
              setEditedMetadata({ ...metadata, areaId })
            }
            value={metadata.areaId}
          />
        )}
        value={metadata}
      />

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
