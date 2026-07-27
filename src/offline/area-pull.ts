import { z } from "zod";

import { areaResponseSchema } from "@/domain/area/area";
import { apiRequest } from "@/lib/api-client";

import type { RailsDatabase } from "./db";

const responseSchema = z.object({ items: z.array(areaResponseSchema) });

/** Refreshes the local Area directory without replacing pending local creates. */
export async function pullAreas(db: RailsDatabase): Promise<void> {
  const response = await apiRequest<unknown>("/api/v1/areas");
  if (!response.ok || !response.body) return;
  const { items } = responseSchema.parse(response.body);

  await db.transaction("rw", db.areas, async () => {
    for (const area of items) {
      const local = await db.areas.get(area.id);
      if (
        !local ||
        (local.syncState === "synced" && area.version >= local.version)
      ) {
        await db.areas.put({
          id: area.id,
          name: area.name,
          version: area.version,
          createdAt: area.createdAt,
          syncState: "synced",
        });
      }
    }
  });
}
