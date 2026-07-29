"use client";

import { useState } from "react";
import { CheckIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

import { SETTINGS_SECTION_CLASS_NAME } from "./settings-section";

const choices = [
  {
    value: "light",
    label: "Light",
    description: "A bright, high-contrast canvas.",
    icon: SunIcon,
  },
  {
    value: "dark",
    label: "Dark",
    description: "A calm, low-light canvas.",
    icon: MoonIcon,
  },
  {
    value: "system",
    label: "System",
    description: "Follow this device automatically.",
    icon: CheckIcon,
  },
] as const;

export function AppearanceSettings() {
  const { theme = "system", setTheme } = useTheme();
  const [status, setStatus] = useState<string | null>(null);

  function choose(value: (typeof choices)[number]["value"], label: string) {
    setTheme(value);
    setStatus(`Appearance set to ${label}.`);
  }

  return (
    <section
      aria-labelledby="appearance-title"
      className={SETTINGS_SECTION_CLASS_NAME}
      id="appearance"
    >
      <h2 id="appearance-title" className="text-lg font-medium">
        Appearance
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose a theme for this device. System is used until you choose
        otherwise.
      </p>

      <fieldset
        aria-label="Choose appearance"
        className="mt-5 grid gap-3 sm:grid-cols-3"
      >
        <legend className="sr-only">Choose appearance</legend>
        {choices.map(({ value, label, description, icon: Icon }) => (
          <label
            className={cn(
              "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50",
              theme === value && "border-foreground bg-muted/50",
            )}
            key={value}
          >
            <input
              aria-label={label}
              checked={theme === value}
              className="sr-only"
              name="appearance"
              onChange={() => choose(value, label)}
              type="radio"
              value={value}
            />
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {status ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
