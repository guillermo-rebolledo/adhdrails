"use client";

import { X } from "lucide-react";

import type { CaptureChip, ChipKind } from "@/domain/capture/parser";

const KIND_LABEL: Record<ChipKind, string> = {
  date: "Date",
  time: "Time",
  duration: "Duration",
};

/**
 * The editable representation of what the parser detected, shown before a
 * capture is classified. Each chip is removable so the user can correct a
 * false positive — a core part of keeping the parser conservative and the
 * correction flow accessible. Chips are not read-only decoration: removing one
 * drops that value from what a confirmation would carry.
 */
export function CaptureChips({
  chips,
  onRemove,
}: {
  chips: CaptureChip[];
  onRemove: (kind: ChipKind) => void;
}) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Detected details" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.kind}>
          <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-1 pr-1 pl-3 text-sm">
            <span className="text-muted-foreground">
              {KIND_LABEL[chip.kind]}
            </span>
            <span className="font-medium">{chip.label}</span>
            <button
              aria-label={`Remove ${KIND_LABEL[chip.kind].toLowerCase()} ${chip.label}`}
              className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() => onRemove(chip.kind)}
              type="button"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
