"use client";

import { Button } from "@/components/ui/button";
import { TASK_ENERGIES, type TaskEnergy } from "@/domain/task/task";

/**
 * "Energy right now" — a calm, low-commitment control for how a user feels.
 * Choosing Low, Medium, or High reorders flexible work to match capacity;
 * "Not set" clears the choice. It is a plain group of toggle buttons rather
 * than a slider or score, and the current selection is announced through
 * `aria-pressed`, so the state is available to a screen reader without any
 * visual-only cue.
 */
const ENERGY_LABELS: Record<TaskEnergy, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function EnergyRightNow({
  energy,
  onChange,
}: {
  energy: TaskEnergy | null;
  onChange: (energy: TaskEnergy | null) => void;
}) {
  return (
    <div
      aria-label="Energy right now"
      className="flex flex-col gap-2"
      role="group"
    >
      <p className="text-sm font-medium text-muted-foreground">
        Energy right now
      </p>
      <div className="flex flex-wrap gap-1.5">
        {TASK_ENERGIES.map((value) => (
          <Button
            aria-pressed={energy === value}
            key={value}
            onClick={() => onChange(energy === value ? null : value)}
            size="sm"
            variant={energy === value ? "default" : "outline"}
          >
            {ENERGY_LABELS[value]}
          </Button>
        ))}
        <Button
          aria-pressed={energy === null}
          onClick={() => onChange(null)}
          size="sm"
          variant={energy === null ? "default" : "outline"}
        >
          Not set
        </Button>
      </div>
    </div>
  );
}
