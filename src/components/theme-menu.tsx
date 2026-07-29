"use client";

import { CheckIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { useAnalytics } from "@/components/analytics/analytics-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const themes = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: CheckIcon },
] as const;

export function ThemeMenu() {
  const { theme = "system", setTheme } = useTheme();
  const analytics = useAnalytics();

  function chooseTheme(value: string) {
    setTheme(value);
    if (value === "light" || value === "dark" || value === "system") {
      analytics.track({ name: "theme_changed", theme: value });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Choose appearance"
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <SunIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={chooseTheme}>
            {themes.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
