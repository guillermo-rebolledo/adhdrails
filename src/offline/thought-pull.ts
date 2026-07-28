import { z } from "zod";

import { thoughtResponseSchema } from "@/domain/thought/thought";
import { apiRequest } from "@/lib/api-client";

import type { RailsDatabase } from "./db";

const responseSchema = z.object({ thoughts: z.array(thoughtResponseSchema) });

/** Reconciles server-confirmed Thoughts into Dexie without replacing pending edits. */
export async function pullThoughts(db: RailsDatabase): Promise<void> {
  const response = await apiRequest<unknown>("/api/v1/thoughts");
  if (!response.ok) return;
  const { thoughts } = responseSchema.parse(response.body);
  await db.transaction("rw", db.thoughts, async () => {
    for (const thought of thoughts) {
      const local = await db.thoughts.get(thought.id);
      // An optimistic deletion in its Undo window is stamped `deletedAt` locally
      // but not yet synced, so the server still returns the Thought. Overwriting
      // it here would clear `deletedAt` and resurrect the Thought mid-undo — an
      // accidental loss of the user's intent. Leave any locally-deleted Thought
      // alone; the deletion (or its Undo) reconciles through the outbox instead.
      if (local?.deletedAt) {
        continue;
      }
      if (
        !local ||
        (local.syncState === "synced" && thought.version > local.version)
      ) {
        await db.thoughts.put({ ...thought, syncState: "synced" });
      }
    }
  });
}
