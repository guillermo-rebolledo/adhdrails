"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PlusIcon } from "lucide-react";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { areaNamesMatch } from "@/domain/area/area";
import { resolveOrCreateArea } from "@/offline/area-commands";
import { useOffline } from "@/offline/provider";

/**
 * One row in the Area combobox. A `creatable` row is the "Create …" affordance
 * shown when the typed name matches no existing Area; its `value` is the display
 * label and `creatable` carries the raw name to create.
 */
interface AreaItem {
  id: string;
  value: string;
  creatable?: string;
}

/**
 * A single-select Area picker built on the shadcn Base Combobox. It lists the
 * account's Areas from the local replica (so it works offline) and, when the
 * typed name matches nothing, offers a "Create …" row that creates the Area on
 * entry and selects it. A Task may carry at most one Area, so this is
 * single-select; clearing the input clears the Area.
 */
export function AreaCombobox({
  id,
  value,
  onValueChange,
}: {
  id?: string;
  /** The selected Area id, or null when the Task has no Area. */
  value: string | null;
  onValueChange: (areaId: string | null) => void;
}) {
  const { db, sync } = useOffline();
  const areas =
    useLiveQuery(() => db.areas.orderBy("name").toArray(), [db]) ?? [];

  const [query, setQuery] = useState("");
  // Tracks the selection the input text was last synced to, so mirroring the
  // selected Area's name into the input never clobbers in-progress typing.
  const syncedFor = useRef<string | null | undefined>(undefined);

  const items: AreaItem[] = areas.map((area) => ({
    id: area.id,
    value: area.name,
  }));
  const selected = items.find((item) => item.id === value) ?? null;
  // `null` means the selected id has not loaded from the replica yet; "" means
  // there is no selection to display.
  const selectedName = value ? (selected?.value ?? null) : "";

  useEffect(() => {
    if (selectedName === null) {
      return;
    }
    if (syncedFor.current === value) {
      return;
    }
    syncedFor.current = value ?? null;
    setQuery(selectedName);
  }, [value, selectedName]);

  const trimmed = query.trim();
  const lowered = trimmed.toLocaleLowerCase();
  const exactExists = areas.some((area) => areaNamesMatch(area.name, trimmed));
  const itemsForView: AreaItem[] =
    trimmed !== "" && !exactExists
      ? [
          ...items,
          {
            id: `create:${lowered}`,
            value: `Create "${trimmed}"`,
            creatable: trimmed,
          },
        ]
      : items;

  async function handleValueChange(next: AreaItem | null) {
    if (next === null) {
      onValueChange(null);
      return;
    }
    if (next.creatable) {
      const area = await resolveOrCreateArea(db, next.creatable);
      onValueChange(area.id);
      void sync();
      return;
    }
    onValueChange(next.id);
  }

  return (
    <Combobox<AreaItem>
      filter={null}
      inputValue={query}
      isItemEqualToValue={(a, b) => a.id === b.id}
      items={itemsForView}
      itemToStringLabel={(item) => item.value}
      itemToStringValue={(item) => item.id}
      onInputValueChange={setQuery}
      onOpenChange={(open) => {
        if (!open) {
          setQuery(selectedName ?? "");
        }
      }}
      onValueChange={handleValueChange}
      value={selected}
    >
      <ComboboxInputGroup>
        <ComboboxInput id={id} placeholder="Choose or create an area" />
        <ComboboxTrigger aria-label="Show areas" />
      </ComboboxInputGroup>
      <ComboboxPopup>
        <ComboboxEmpty>No areas yet — type a name to create one.</ComboboxEmpty>
        <ComboboxList>
          {(item: AreaItem) => (
            <ComboboxItem key={item.id} value={item}>
              {item.creatable ? (
                <span className="flex items-center gap-2">
                  <PlusIcon className="size-4" />
                  {item.value}
                </span>
              ) : (
                item.value
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
