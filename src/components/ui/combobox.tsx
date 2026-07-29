"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A shadcn-styled wrapper over the Base UI Combobox. Base UI keeps ownership of
 * behavior, focus management, and accessibility; these thin components only
 * apply the app's semantic theme tokens. Parts are re-exported individually so a
 * feature (such as the Area picker) can compose exactly the shape it needs,
 * including externally filtered `filteredItems` and create-on-entry rows.
 */

function Combobox<Value, Multiple extends boolean | undefined = false>(
  props: ComboboxPrimitive.Root.Props<Value, Multiple>,
) {
  return <ComboboxPrimitive.Root data-slot="combobox" {...props} />;
}

function ComboboxInputGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-input-group"
      className={cn("relative flex items-center", className)}
      {...props}
    />
  );
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-9 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "absolute right-1 flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? <ChevronsUpDownIcon className="size-4" />}
    </ComboboxPrimitive.Trigger>
  );
}

function ComboboxPopup({
  className,
  sideOffset = 4,
  ...props
}: ComboboxPrimitive.Popup.Props & {
  sideOffset?: number;
}) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        className="isolate z-50 outline-none"
        sideOffset={sideOffset}
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-popup"
          className={cn(
            "max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "px-3 py-4 text-center text-sm text-muted-foreground data-empty:block",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "max-h-[min(20rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-none",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-8 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <ComboboxPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </ComboboxPrimitive.ItemIndicator>
      </span>
      {children}
    </ComboboxPrimitive.Item>
  );
}

export {
  Combobox,
  ComboboxInputGroup,
  ComboboxInput,
  ComboboxTrigger,
  ComboboxPopup,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
};
