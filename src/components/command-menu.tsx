"use client";

import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import {
  CheckSquareIcon,
  InboxIcon,
  LightbulbIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";

import {
  type NavigationDestination,
  navigationDestinations,
} from "@/components/navigation-items";
import { Button } from "@/components/ui/button";
import type { SearchResultType } from "@/domain/search/search";
import { useContentSearch } from "@/hooks/use-content-search";
import { cn } from "@/lib/utils";

interface CommandEntry extends NavigationDestination {
  /** Single-key accelerator, present only for the four quick actions. Pressing
   *  it from the empty palette runs the action. */
  shortcut?: string;
  typeLabel?: string;
}

// The four creation/capture actions come first so the palette opens on the fast
// path. Their single-letter accelerators mirror the labels a user reads.
const actions: CommandEntry[] = [
  {
    id: "capture",
    label: "Capture",
    href: "/today",
    icon: SparklesIcon,
    keywords: ["quick", "note", "inbox", "jot"],
    shortcut: "C",
  },
  {
    id: "new-task",
    label: "New Task",
    href: "/tasks/new",
    icon: PlusIcon,
    keywords: ["create", "todo", "add"],
    shortcut: "T",
  },
  {
    id: "new-event",
    label: "New Event",
    href: "/calendar/events/new",
    icon: PlusIcon,
    keywords: ["create", "meeting", "calendar", "add"],
    shortcut: "E",
  },
  {
    id: "new-thought",
    label: "New Thought",
    href: "/thoughts/new",
    icon: PlusIcon,
    keywords: ["create", "idea", "reference", "add"],
    shortcut: "N",
  },
];

const destinations: CommandEntry[] = navigationDestinations;

const searchResultIcons = {
  task: CheckSquareIcon,
  thought: LightbulbIcon,
  inbox_item: InboxIcon,
} satisfies Record<SearchResultType, typeof SearchIcon>;
const searchResultLabels = {
  task: "Task",
  thought: "Thought",
  inbox_item: "Inbox item",
} satisfies Record<SearchResultType, string>;

interface CommandGroup {
  heading: string;
  entries: CommandEntry[];
}

function matches(entry: CommandEntry, query: string): boolean {
  const haystack = [entry.label, ...entry.keywords].join(" ").toLowerCase();
  return haystack.includes(query);
}

/**
 * The Raycast-inspired command palette. `Command`/`Control` + `K` opens it from
 * anywhere, and a visible launcher offers the same experience to touch users
 * without a hardware keyboard. Base UI's Dialog owns focus management, focus
 * restoration, and the modal semantics; this component layers the ARIA combobox
 * pattern and restrained, reduced-motion-aware transitions on top.
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false);

  // A single global listener turns the palette into an app-wide affordance. It
  // toggles so the same chord dismisses an open palette.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={
          <Button
            aria-label="Open command menu"
            className="gap-2 text-muted-foreground md:min-w-56 md:justify-start"
            size="sm"
            variant="outline"
          />
        }
      >
        <SearchIcon />
        <span className="hidden md:inline">Search</span>
        <kbd className="ml-auto hidden items-center gap-0.5 rounded border bg-muted px-1.5 font-sans text-[0.7rem] text-muted-foreground md:inline-flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        {/* The palette itself opens instantly and stays that way — it is a
            keyboard tool, and any transition on it is latency the user feels
            between the shortcut and typing. Its scrim is a different question:
            an 80% wash of the background appearing in one frame is an abrupt
            brightness jump across the whole viewport, which is the kind of
            change reduced-motion users are protected from for good reason.
            Crossfading only the scrim, faster than the eye tracks, removes the
            jump without putting a single frame between ⌘K and the input. */}
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-background/80 transition-opacity duration-(--motion-fast) ease-material data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs motion-reduce:transition-none" />
        <Dialog.Popup
          className={cn(
            // Full-screen on mobile so the palette is usable by touch alone;
            // a centered card on larger screens.
            "fixed inset-x-0 top-0 z-50 flex h-dvh flex-col bg-popover text-popover-foreground outline-none",
            "sm:top-[12vh] sm:left-1/2 sm:h-auto sm:max-h-[70vh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:rounded-xl sm:border sm:shadow-lg",
          )}
        >
          <Dialog.Title className="sr-only">Command menu</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search destinations or run a quick action. Use the arrow keys to
            move and Enter to choose.
          </Dialog.Description>
          <CommandPalette onClose={() => setOpen(false)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionBaseId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedQuery = query.trim().toLowerCase();
  const {
    items: contentResults,
    loading: contentLoading,
    source: contentSource,
  } = useContentSearch(query);
  const contentEntries = useMemo<CommandEntry[]>(
    () =>
      contentResults.map((result) => ({
        id: `${result.type}:${result.id}`,
        label: result.title,
        href: result.href,
        icon: searchResultIcons[result.type],
        keywords: [],
        typeLabel: searchResultLabels[result.type],
      })),
    [contentResults],
  );

  const groups = useMemo<CommandGroup[]>(() => {
    const build = (heading: string, entries: CommandEntry[]) => ({
      heading,
      entries: normalizedQuery
        ? entries.filter((entry) => matches(entry, normalizedQuery))
        : entries,
    });

    return [
      build("Actions", actions),
      build("Destinations", destinations),
      { heading: "Your content", entries: contentEntries },
    ].filter((group) => group.entries.length > 0);
  }, [contentEntries, normalizedQuery]);

  // A flat, keyboard-navigable view of what is currently visible.
  const flatEntries = useMemo(
    () => groups.flatMap((group) => group.entries),
    [groups],
  );

  const visibleActiveIndex =
    flatEntries.length === 0
      ? 0
      : Math.min(activeIndex, flatEntries.length - 1);

  // Base UI moves focus into the popup on open; land it on the search field so
  // typing filters immediately and screen readers announce the combobox.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function navigate(entry: CommandEntry) {
    onClose();
    router.push(entry.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        flatEntries.length === 0 ? 0 : (index + 1) % flatEntries.length,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        flatEntries.length === 0
          ? 0
          : (index - 1 + flatEntries.length) % flatEntries.length,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const entry = flatEntries[visibleActiveIndex];
      if (entry) {
        navigate(entry);
      }
      return;
    }

    // Quick-action accelerators fire only from the empty palette, so they never
    // hijack a search that happens to begin with C, T, E, or N — typing always
    // filters. This is the "command-menu prefix" the spec asks for: the single
    // keys act only after invocation, never as global shortcuts.
    if (
      normalizedQuery === "" &&
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const action = actions.find(
        (entry) => entry.shortcut?.toLowerCase() === event.key.toLowerCase(),
      );
      if (action) {
        event.preventDefault();
        navigate(action);
      }
    }
  }

  const activeId =
    flatEntries.length > 0
      ? `${optionBaseId}-${visibleActiveIndex}`
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <SearchIcon
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
        <input
          aria-activedescendant={activeId}
          aria-controls={listId}
          aria-expanded="true"
          aria-label="Search destinations and actions"
          autoComplete="off"
          className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
          onChange={(event) => {
            // Reset the active option as the visible set changes so it never
            // points past the end of a narrowed list.
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search or jump to…"
          ref={inputRef}
          role="combobox"
          type="text"
          value={query}
        />
      </div>
      <p className="sr-only" role="status">
        {contentLoading
          ? "Searching your content."
          : normalizedQuery
            ? `${contentResults.length} content ${contentResults.length === 1 ? "result" : "results"}${contentSource === "offline" ? " available offline" : ""}.`
            : ""}
      </p>
      <div
        aria-label="Results"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
        id={listId}
        role="listbox"
      >
        {flatEntries.length === 0 && !contentLoading ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            No matches. Try a different search.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.heading} className="mb-1 last:mb-0">
              <p
                aria-hidden="true"
                className="px-2 pt-2 pb-1 text-xs font-medium text-foreground"
              >
                {group.heading}
              </p>
              {group.entries.map((entry) => {
                // Its position in the flat list is the option's stable index, so
                // roving focus and the visible order stay in lockstep.
                const index = flatEntries.indexOf(entry);
                const isActive = index === visibleActiveIndex;
                const Icon = entry.icon;

                return (
                  <button
                    key={entry.id}
                    aria-selected={isActive}
                    className={cn(
                      "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none [&_svg]:size-4 [&_svg]:shrink-0",
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-foreground/90",
                    )}
                    id={`${optionBaseId}-${index}`}
                    onClick={() => navigate(entry)}
                    onPointerMove={() => setActiveIndex(index)}
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    <Icon aria-hidden="true" />
                    <span className="flex-1">{entry.label}</span>
                    {entry.typeLabel ? (
                      <span className="rounded-full bg-background px-1.5 text-xs text-foreground">
                        {entry.typeLabel}
                      </span>
                    ) : null}
                    {entry.shortcut ? (
                      <kbd className="rounded border bg-background px-1.5 font-sans text-[0.7rem] text-muted-foreground">
                        {entry.shortcut}
                      </kbd>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
