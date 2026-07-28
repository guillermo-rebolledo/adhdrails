import {
  CalendarDaysIcon,
  CheckSquareIcon,
  InboxIcon,
  LightbulbIcon,
  type LucideIcon,
  SearchIcon,
  SettingsIcon,
  SunMediumIcon,
} from "lucide-react";

/**
 * The app's primary destinations, defined once and shared by every surface that
 * has to stay in lockstep: the desktop sidebar, the mobile drawer, and the
 * command palette. Adding or renaming a destination happens here, so the
 * navigation views can never drift apart.
 */
export interface NavigationDestination {
  /** Stable identifier, also used to key command-palette options. */
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra terms folded into the command palette's substring match so intent,
   *  not just the visible label, is searchable. Ignored by the nav lists. */
  keywords: string[];
}

export const navigationDestinations: NavigationDestination[] = [
  {
    id: "today",
    label: "Today",
    href: "/today",
    icon: SunMediumIcon,
    keywords: ["home", "now"],
  },
  {
    id: "inbox",
    label: "Inbox",
    href: "/inbox",
    icon: InboxIcon,
    keywords: ["captured", "review"],
  },
  {
    id: "tasks",
    label: "Tasks",
    href: "/tasks",
    icon: CheckSquareIcon,
    keywords: ["todo", "work"],
  },
  {
    id: "calendar",
    label: "Calendar",
    href: "/calendar",
    icon: CalendarDaysIcon,
    keywords: ["agenda", "week", "events"],
  },
  {
    id: "thoughts",
    label: "Thoughts",
    href: "/thoughts",
    icon: LightbulbIcon,
    keywords: ["ideas", "notes", "reference"],
  },
  {
    id: "search",
    label: "Search",
    href: "/search",
    icon: SearchIcon,
    keywords: ["find", "look up"],
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: SettingsIcon,
    keywords: ["preferences", "account", "appearance"],
  },
];
