"use client";

import { type FormEvent, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AreaCombobox } from "@/components/task/area-combobox";
import {
  metadataToPlanningInput,
  type TaskMetadataDraft,
  TaskPlanningFields,
} from "@/components/task/task-planning-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TASK_TITLE_MAX_LENGTH } from "@/domain/task/task";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { createTask } from "@/offline/task-commands";
import { useOffline } from "@/offline/provider";

const DRAFT_KEY = "task-new";

const EMPTY_METADATA: TaskMetadataDraft = {
  scheduledDate: "",
  scheduledTime: "",
  estimateMinutes: "",
  energy: "",
  important: false,
  notes: "",
  areaId: null,
};

/**
 * The dedicated full-page Task creation flow. A Task needs only a title;
 * everything else is optional planning metadata. The title is backed by a
 * debounced device-local draft, so navigating away or being interrupted never
 * loses in-progress input. On submit the Task and its metadata are written to the
 * local replica and acknowledged immediately; the sync engine delivers it in the
 * background.
 */
export function TaskCreateForm({
  initialTitle = "",
}: {
  initialTitle?: string;
}) {
  const { db, sync } = useOffline();
  const router = useRouter();
  const inputId = useId();
  const draft = useLocalDraft(DRAFT_KEY, initialTitle);
  const [metadata, setMetadata] = useState<TaskMetadataDraft>(EMPTY_METADATA);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.value.trim();
    if (trimmed === "" || submitting) {
      return;
    }

    setSubmitting(true);
    await createTask(db, {
      title: trimmed,
      ...metadataToPlanningInput(metadata),
    });
    draft.clear();
    void sync();
    router.push("/today");
  }

  return (
    <form
      aria-label="New task"
      className="flex flex-col gap-6"
      onSubmit={onSubmit}
    >
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={inputId}>
          Task title
        </label>
        <Input
          autoComplete="off"
          autoFocus
          id={inputId}
          maxLength={TASK_TITLE_MAX_LENGTH}
          name="title"
          onChange={(event) => draft.setValue(event.target.value)}
          placeholder="What needs doing?"
          value={draft.value}
        />
        <p className="text-xs text-muted-foreground">
          A title is all you need. Everything below is optional.
        </p>
      </div>

      <TaskPlanningFields
        onChange={setMetadata}
        renderAreaField={(areaInputId) => (
          <AreaCombobox
            id={areaInputId}
            onValueChange={(areaId) =>
              setMetadata((current) => ({ ...current, areaId }))
            }
            value={metadata.areaId}
          />
        )}
        value={metadata}
      />

      <div className="flex gap-2">
        <Button
          disabled={draft.value.trim() === "" || submitting}
          type="submit"
        >
          Create task
        </Button>
        <Link className={buttonVariants({ variant: "ghost" })} href="/today">
          Cancel
        </Link>
      </div>
    </form>
  );
}
