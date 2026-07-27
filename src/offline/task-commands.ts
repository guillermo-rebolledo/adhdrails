import {
  resolveCompletedAt,
  type TaskEnergy,
  taskCreateRequestSchema,
  type TaskPatch,
} from "@/domain/task/task";

import type { LocalTask, OutboxEntry, RailsDatabase } from "./db";

/**
 * The optional planning metadata a Task create may carry alongside its title. An
 * omitted field means "not set"; title-only capture stays valid.
 */
export interface TaskPlanningInput {
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  estimateMinutes?: number | null;
  energy?: TaskEnergy | null;
  important?: boolean;
  notes?: string;
  areaId?: string | null;
}

export interface CreateTaskInput extends TaskPlanningInput {
  title: string;
}

export interface CreateTaskOptions {
  id?: string;
  idempotencyKey?: string;
  outboxId?: string;
  now?: string;
}

/** The planning fields present on an input, with the title stripped out. */
function planningFields(input: TaskPlanningInput): TaskPlanningInput {
  const { scheduledDate, scheduledTime, estimateMinutes, energy, important } =
    input;
  const fields: TaskPlanningInput = {};
  if (scheduledDate !== undefined) fields.scheduledDate = scheduledDate;
  if (scheduledTime !== undefined) fields.scheduledTime = scheduledTime;
  if (estimateMinutes !== undefined) fields.estimateMinutes = estimateMinutes;
  if (energy !== undefined) fields.energy = energy;
  if (important !== undefined) fields.important = important;
  if (input.notes !== undefined) fields.notes = input.notes;
  if (input.areaId !== undefined) fields.areaId = input.areaId;
  return fields;
}

/**
 * Builds the optimistic local Task and its create outbox entry, without
 * touching the database. Shared by {@link createTask} and the Inbox-Item
 * classification path so the Task's local shape and outbox payload have one
 * definition. The caller commits both records in whatever transaction it owns.
 */
export function buildTaskCreate(
  input: CreateTaskInput,
  options: CreateTaskOptions = {},
): { task: LocalTask; entry: OutboxEntry } {
  const id = options.id ?? crypto.randomUUID();
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const createdAt = options.now ?? new Date().toISOString();

  const request = taskCreateRequestSchema.parse({
    id,
    title: input.title,
    idempotencyKey,
    ...planningFields(input),
  });

  const task: LocalTask = {
    id,
    title: request.title,
    status: "active",
    scheduledDate: request.scheduledDate ?? null,
    scheduledTime: request.scheduledTime ?? null,
    estimateMinutes: request.estimateMinutes ?? null,
    energy: request.energy ?? null,
    important: request.important ?? false,
    notes: request.notes ?? "",
    areaId: request.areaId ?? null,
    completedAt: null,
    version: 1,
    createdAt,
    deletedAt: null,
    syncState: "pending",
  };

  const entry: OutboxEntry = {
    id: options.outboxId ?? crypto.randomUUID(),
    entity: "task",
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

  return { task, entry };
}

/**
 * Creates a title-only Task. In one atomic Dexie transaction it writes the
 * optimistic local Task and its create outbox entry, so the Task is never
 * acknowledged locally without a durable instruction to synchronize it. The
 * client-generated id becomes the server id, so the record never needs
 * temporary-ID remapping.
 */
export async function createTask(
  db: RailsDatabase,
  input: CreateTaskInput,
  options: CreateTaskOptions = {},
): Promise<LocalTask> {
  const { task, entry } = buildTaskCreate(input, options);

  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.add(task);
    await db.outbox.add(entry);
  });

  return task;
}

export interface UpdateTaskOptions {
  idempotencyKey?: string;
  outboxId?: string;
  now?: string;
}

/**
 * Applies an edit or status change to a local Task and queues its delivery. The
 * outbox entry carries the last server-confirmed `version` as its base version,
 * so the server can detect a stale write. Repeated pending edits to the same
 * Task coalesce into one entry (keeping the original base version) rather than
 * racing each other to the server.
 */
export async function updateTask(
  db: RailsDatabase,
  id: string,
  patch: TaskPatch,
  options: UpdateTaskOptions = {},
): Promise<void> {
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const now = options.now ?? new Date().toISOString();

  await db.transaction("rw", db.tasks, db.outbox, async () => {
    const local = await db.tasks.get(id);
    if (!local) {
      return;
    }

    const updated: LocalTask = {
      ...local,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      // A planning field present in the patch is applied; `null` clears it. An
      // absent field leaves the local value untouched.
      ...("scheduledDate" in patch
        ? { scheduledDate: patch.scheduledDate ?? null }
        : {}),
      ...("scheduledTime" in patch
        ? { scheduledTime: patch.scheduledTime ?? null }
        : {}),
      ...("estimateMinutes" in patch
        ? { estimateMinutes: patch.estimateMinutes ?? null }
        : {}),
      ...("energy" in patch ? { energy: patch.energy ?? null } : {}),
      ...(patch.important !== undefined ? { important: patch.important } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...("areaId" in patch ? { areaId: patch.areaId ?? null } : {}),
      completedAt: resolveCompletedAt(local.completedAt, patch.status, now),
      syncState: "pending",
    };
    await db.tasks.put(updated);

    const [pending] = await db.outbox
      .filter(
        (entry) =>
          entry.entityId === id &&
          entry.operation === "update" &&
          entry.status === "pending",
      )
      .toArray();

    if (pending) {
      const previousPatch = (pending.payload.patch ?? {}) as TaskPatch;
      const mergedPatch = { ...previousPatch, ...patch };
      await db.outbox.update(pending.id, {
        payload: { ...pending.payload, patch: mergedPatch },
      });
      return;
    }

    const entry: OutboxEntry = {
      id: options.outboxId ?? crypto.randomUUID(),
      entity: "task",
      operation: "update",
      entityId: id,
      idempotencyKey,
      baseVersion: local.version,
      payload: { idempotencyKey, baseVersion: local.version, patch },
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: now,
    };
    await db.outbox.add(entry);
  });
}

/** Marks a Task completed. A calm acknowledgement is the UI's responsibility. */
export function completeTask(
  db: RailsDatabase,
  id: string,
  options: UpdateTaskOptions = {},
): Promise<void> {
  return updateTask(db, id, { status: "completed" }, options);
}

/** Returns a completed Task to active (the completion Undo path). */
export function uncompleteTask(
  db: RailsDatabase,
  id: string,
  options: UpdateTaskOptions = {},
): Promise<void> {
  return updateTask(db, id, { status: "active" }, options);
}

/**
 * Begins an app-owned deletion: the Task is hidden optimistically by stamping
 * `deletedAt`, but nothing is sent yet. The 10-second Undo window is the UI's
 * responsibility; {@link restoreTask} reverses this, {@link finalizeTaskDeletion}
 * commits it.
 */
export async function deleteTaskLocally(
  db: RailsDatabase,
  id: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  await db.tasks.update(id, { deletedAt: now });
}

/** Reverses a pending deletion within the Undo window. */
export async function restoreTask(
  db: RailsDatabase,
  id: string,
): Promise<void> {
  await db.tasks.update(id, { deletedAt: null });
}

export interface FinalizeDeletionOptions {
  idempotencyKey?: string;
  outboxId?: string;
  now?: string;
}

/**
 * Commits an app-owned deletion once the Undo window elapses. It removes the
 * local row and any superseded pending mutations for the Task, then queues one
 * idempotent delete. The server delete writes a 30-day tombstone that prevents
 * a queued create or update from resurrecting the Task.
 */
export async function finalizeTaskDeletion(
  db: RailsDatabase,
  id: string,
  options: FinalizeDeletionOptions = {},
): Promise<void> {
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const now = options.now ?? new Date().toISOString();

  await db.transaction("rw", db.tasks, db.outbox, async () => {
    const local = await db.tasks.get(id);
    const baseVersion = local?.version ?? null;

    const superseded = await db.outbox
      .filter((entry) => entry.entityId === id)
      .toArray();
    await db.outbox.bulkDelete(superseded.map((entry) => entry.id));

    await db.tasks.delete(id);

    const entry: OutboxEntry = {
      id: options.outboxId ?? crypto.randomUUID(),
      entity: "task",
      operation: "delete",
      entityId: id,
      idempotencyKey,
      baseVersion,
      payload: {},
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: now,
    };
    await db.outbox.add(entry);
  });
}
