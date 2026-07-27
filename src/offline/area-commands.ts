import { areaCreateRequestSchema, areaNamesMatch } from "@/domain/area/area";

import type { LocalArea, OutboxEntry, RailsDatabase } from "./db";

export interface CreateAreaOptions {
  id?: string;
  idempotencyKey?: string;
  outboxId?: string;
  now?: string;
}

/**
 * Builds the optimistic local Area and its create outbox entry, without touching
 * the database. The client-generated id becomes the server id, so the Area never
 * needs temporary-ID remapping and a Task can reference it immediately.
 */
export function buildAreaCreate(
  name: string,
  options: CreateAreaOptions = {},
): { area: LocalArea; entry: OutboxEntry } {
  const id = options.id ?? crypto.randomUUID();
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const createdAt = options.now ?? new Date().toISOString();

  const request = areaCreateRequestSchema.parse({ id, name, idempotencyKey });

  const area: LocalArea = {
    id,
    name: request.name,
    version: 1,
    createdAt,
    syncState: "pending",
  };

  const entry: OutboxEntry = {
    id: options.outboxId ?? crypto.randomUUID(),
    entity: "area",
    operation: "create",
    entityId: id,
    idempotencyKey,
    baseVersion: null,
    payload: request,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt,
  };

  return { area, entry };
}

/**
 * Resolves an Area by name, creating one when none matches. Matching is
 * case-insensitive so "Work" and "work" reuse the same Area rather than
 * duplicating it. When a new Area is created, its optimistic row and create
 * outbox entry are committed in one atomic transaction, then the Area is
 * returned so the Task form can reference its id right away. Returns the existing
 * Area unchanged when one already matches.
 */
export async function resolveOrCreateArea(
  db: RailsDatabase,
  name: string,
  options: CreateAreaOptions = {},
): Promise<LocalArea> {
  const trimmed = name.trim();
  const existing = await db.areas
    .filter((candidate) => areaNamesMatch(candidate.name, trimmed))
    .first();
  if (existing) {
    return existing;
  }

  const { area, entry } = buildAreaCreate(trimmed, options);
  await db.transaction("rw", db.areas, db.outbox, async () => {
    await db.areas.add(area);
    await db.outbox.add(entry);
  });
  return area;
}
