"use client";

import { type ReactNode, useId } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  TASK_ENERGIES,
  TASK_ESTIMATE_MAX_MINUTES,
  TASK_NOTES_MAX_LENGTH,
  type TaskEnergy,
} from "@/domain/task/task";
import type { TaskPlanningInput } from "@/offline/task-commands";

/**
 * The Task planning metadata as the forms hold it while editing: all strings and
 * a Boolean, so empty inputs are simply empty. {@link metadataToPlanningInput}
 * converts this into the domain-shaped {@link TaskPlanningInput} on submit.
 * `energy` is `""` for unset (Any); `areaId` is owned by the slotted Area field.
 */
export interface TaskMetadataDraft {
  scheduledDate: string;
  scheduledTime: string;
  estimateMinutes: string;
  energy: "" | TaskEnergy;
  important: boolean;
  notes: string;
  areaId: string | null;
}

const ENERGY_LABELS: Record<TaskEnergy, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** Converts a form draft into the domain planning shape, dropping empty fields. */
export function metadataToPlanningInput(
  draft: TaskMetadataDraft,
): TaskPlanningInput {
  const scheduledDate = draft.scheduledDate || null;
  // A time is only meaningful with a date; without one it is discarded so the
  // Task stays a coherent date-only (or unscheduled) Task.
  const scheduledTime = scheduledDate ? draft.scheduledTime || null : null;
  const estimate = draft.estimateMinutes.trim();
  const estimateMinutes = estimate === "" ? null : Number(estimate);

  return {
    scheduledDate,
    scheduledTime,
    estimateMinutes:
      estimateMinutes !== null && Number.isFinite(estimateMinutes)
        ? estimateMinutes
        : null,
    energy: draft.energy || null,
    important: draft.important,
    notes: draft.notes,
    areaId: draft.areaId,
  };
}

/**
 * The optional planning metadata inputs shared by the Task create and edit
 * forms: a Scheduled-for date with an optional time (a date alone is date-only —
 * no timed reminder), an informational estimate, Energy, Important, notes, and a
 * slot for the Area picker. Native date/time/number/checkbox/radio controls keep
 * the form fast, accessible, and fully operable offline. The parent owns the
 * draft state so both forms drive the same shape.
 */
export function TaskPlanningFields({
  value,
  onChange,
  renderAreaField,
}: {
  value: TaskMetadataDraft;
  onChange: (next: TaskMetadataDraft) => void;
  /** Renders the Area picker, wired to the given input id for its label. */
  renderAreaField: (inputId: string) => ReactNode;
}) {
  const dateId = useId();
  const timeId = useId();
  const estimateId = useId();
  const notesId = useId();
  const areaId = useId();
  const energyName = useId();
  const importantId = useId();

  function set<K extends keyof TaskMetadataDraft>(
    key: K,
    fieldValue: TaskMetadataDraft[K],
  ) {
    onChange({ ...value, [key]: fieldValue });
  }

  const hasDate = value.scheduledDate !== "";

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor={dateId}>
            Scheduled for
          </label>
          <Input
            id={dateId}
            name="scheduledDate"
            onChange={(event) => {
              const scheduledDate = event.target.value;
              // Clearing the date also clears the time so a stray time never
              // lingers on an unscheduled Task.
              onChange({
                ...value,
                scheduledDate,
                scheduledTime: scheduledDate ? value.scheduledTime : "",
              });
            }}
            type="date"
            value={value.scheduledDate}
          />
          <p className="text-xs text-muted-foreground">
            A day, not a deadline. Leave the time empty to keep it date-only.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor={timeId}>
            Time (optional)
          </label>
          <Input
            disabled={!hasDate}
            id={timeId}
            name="scheduledTime"
            onChange={(event) => set("scheduledTime", event.target.value)}
            type="time"
            value={value.scheduledTime}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={estimateId}>
          Estimate (minutes)
        </label>
        <Input
          id={estimateId}
          inputMode="numeric"
          max={TASK_ESTIMATE_MAX_MINUTES}
          min={1}
          name="estimateMinutes"
          onChange={(event) => set("estimateMinutes", event.target.value)}
          placeholder="e.g. 25"
          type="number"
          value={value.estimateMinutes}
        />
        <p className="text-xs text-muted-foreground">
          Just a guess to help you plan — never a countdown or a deadline.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Energy</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={value.energy === ""}
              name={energyName}
              onChange={() => set("energy", "")}
              type="radio"
              value=""
            />
            Any
          </label>
          {TASK_ENERGIES.map((energy) => (
            <label className="flex items-center gap-2 text-sm" key={energy}>
              <input
                checked={value.energy === energy}
                name={energyName}
                onChange={() => set("energy", energy)}
                type="radio"
                value={energy}
              />
              {ENERGY_LABELS[energy]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Optional. “Any” means this fits whatever energy you have.
        </p>
      </fieldset>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          checked={value.important}
          id={importantId}
          name="important"
          onChange={(event) => set("important", event.target.checked)}
          type="checkbox"
        />
        Important
      </label>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={areaId}>
          Area (optional)
        </label>
        {renderAreaField(areaId)}
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={notesId}>
          Notes
        </label>
        <Textarea
          id={notesId}
          maxLength={TASK_NOTES_MAX_LENGTH}
          name="notes"
          onChange={(event) => set("notes", event.target.value)}
          value={value.notes}
        />
      </div>
    </div>
  );
}
