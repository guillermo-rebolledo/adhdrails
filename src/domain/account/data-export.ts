import { z } from "zod";

import {
  DEFAULT_REMINDER_PREFERENCES,
  reminderPreferencesSchema,
} from "@/domain/notification/reminder";

/**
 * The pure rules for a user's app-owned data export (MEM-48). This module holds
 * no React, Next.js, Drizzle, or network dependencies — only `zod` and other
 * domain modules. It defines the export document's shape, the redaction that
 * keeps mirrored Google data and secrets out of it, and the small lifecycle
 * helpers (status vocabulary, expiry, filename) shared by the durable job, the
 * API routes, and their tests.
 */

/** The export document format version, bumped when the shape changes. */
export const DATA_EXPORT_SCHEMA_VERSION = 1;

/** How long a completed archive stays downloadable before it is purged. */
export const DATA_EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

/** Only Events the user created in Rails are app-owned; mirrors are excluded. */
export const LOCAL_EVENT_ORIGIN = "local";

/** The lifecycle a durable export job moves through. */
export const DATA_EXPORT_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "expired",
] as const;

export const dataExportStatusSchema = z.enum(DATA_EXPORT_STATUSES);
export type DataExportStatus = z.infer<typeof dataExportStatusSchema>;

/**
 * The status surfaced to Settings. `none` means the account has never requested
 * an export, so the UI can distinguish "never asked" from a finished archive.
 */
export const dataExportViewStatusSchema = z.enum([
  "none",
  ...DATA_EXPORT_STATUSES,
]);
export type DataExportViewStatus = z.infer<typeof dataExportViewStatusSchema>;

export const dataExportStatusResponseSchema = z.object({
  status: dataExportViewStatusSchema,
  requestedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  byteSize: z.number().int().nonnegative().nullable(),
  errorCode: z.string().nullable(),
});
export type DataExportStatusResponse = z.infer<
  typeof dataExportStatusResponseSchema
>;

// The exported collections. Every field is app-owned; internal sync bookkeeping
// (idempotency keys, record versions) and any provider/secret material are
// deliberately absent from these shapes.

const exportedAccountSchema = z.object({
  name: z.string(),
  email: z.string(),
  /** `null` when the account's zone was never recorded. */
  timezone: z.string().nullable(),
  locale: z.string(),
});

const exportedAreaSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const exportedTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  scheduledDate: z.string().nullable(),
  scheduledTime: z.string().nullable(),
  estimateMinutes: z.number().int().nullable(),
  energy: z.string().nullable(),
  important: z.boolean(),
  notes: z.string(),
  areaId: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const exportedThoughtSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const exportedInboxItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  seenAt: z.string().nullable(),
  classifiedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const exportedEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  startTimeZone: z.string(),
  endTimeZone: z.string(),
  isAllDay: z.boolean(),
  allDayStartDate: z.string().nullable(),
  allDayEndDate: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const exportedFocusSessionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  status: z.string(),
  accumulatedSeconds: z.number().int(),
  distractionCount: z.number().int(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const dataExportDocumentSchema = z.object({
  schemaVersion: z.literal(DATA_EXPORT_SCHEMA_VERSION),
  exportedAt: z.string(),
  account: exportedAccountSchema,
  areas: z.array(exportedAreaSchema),
  tasks: z.array(exportedTaskSchema),
  thoughts: z.array(exportedThoughtSchema),
  inboxItems: z.array(exportedInboxItemSchema),
  events: z.array(exportedEventSchema),
  focusSessions: z.array(exportedFocusSessionSchema),
  preferences: z.object({ reminders: reminderPreferencesSchema }),
});
export type DataExportDocument = z.infer<typeof dataExportDocumentSchema>;

/** A single Event row as collected from storage, before redaction. */
export interface SourceEvent extends z.infer<typeof exportedEventSchema> {
  origin: string;
  googleCalendarId: string | null;
  googleEventId: string | null;
}

/**
 * The raw, account-scoped material a data export is assembled from. Timestamps
 * arrive as ISO strings so the builder stays a pure, trivially serializable
 * transform. A `null` `reminderPreferences` means the account has never saved
 * any, and resolves to the domain defaults.
 */
export interface DataExportSource {
  account: z.infer<typeof exportedAccountSchema>;
  areas: z.infer<typeof exportedAreaSchema>[];
  tasks: z.infer<typeof exportedTaskSchema>[];
  thoughts: z.infer<typeof exportedThoughtSchema>[];
  inboxItems: z.infer<typeof exportedInboxItemSchema>[];
  events: SourceEvent[];
  focusSessions: z.infer<typeof exportedFocusSessionSchema>[];
  reminderPreferences: z.infer<typeof reminderPreferencesSchema> | null;
}

/**
 * Assembles the export document from collected data. Redaction is structural:
 * only local Events survive, and their `origin`/provider identifiers are dropped
 * so no mirrored Google data leaves Rails; secrets never enter because the
 * connection is never part of the source. The result is validated against the
 * shared schema so a shape drift fails loudly rather than shipping bad data.
 */
export function buildDataExportDocument(
  source: DataExportSource,
  exportedAt: string,
): DataExportDocument {
  // Only local Events are app-owned. Parsing against `exportedEventSchema`
  // (which has no `origin`/provider fields) strips the mirror identifiers, so
  // no Google-owned data can leak into the archive.
  const events = source.events.filter(
    (event) => event.origin === LOCAL_EVENT_ORIGIN,
  );

  return dataExportDocumentSchema.parse({
    schemaVersion: DATA_EXPORT_SCHEMA_VERSION,
    exportedAt,
    account: source.account,
    areas: source.areas,
    tasks: source.tasks,
    thoughts: source.thoughts,
    inboxItems: source.inboxItems,
    events,
    focusSessions: source.focusSessions,
    preferences: {
      reminders: source.reminderPreferences ?? DEFAULT_REMINDER_PREFERENCES,
    },
  });
}

/** Whether a completed archive's download window has closed. */
export function isDataExportExpired(
  expiresAt: Date | null,
  now: Date,
): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/** The download filename, dated by when the archive was produced. */
export function dataExportFilename(completedAt: Date): string {
  return `rails-export-${completedAt.toISOString().slice(0, 10)}.json`;
}
