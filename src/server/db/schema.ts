import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const seedRecords = pgTable("seed_records", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Authentication tables owned by Better Auth. Column shapes follow Better
 * Auth's core schema so its Drizzle adapter maps models automatically. The
 * `user` table carries a few Rails-owned account fields (timezone, locale,
 * onboarding completion) alongside the identity Better Auth manages.
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  timezone: text("timezone").notNull().default("UTC"),
  locale: text("locale").notNull().default("en-US"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Captured, still-unclassified material owned by one account. The primary key
 * is the client-generated UUID from Quick Capture, so an offline record keeps
 * the same identity once it synchronizes. `version` and `idempotencyKey`
 * support safe retries and reviewable conflicts for the offline mutation
 * tracer; `seenAt` drives the numberless unseen badge (null means unseen).
 */
export const inboxItem = pgTable(
  "inbox_item",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    idempotencyKey: uuid("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("inbox_item_account_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
  ],
);

/**
 * An app-owned Inbox Item deletion tombstone. It marks that an Inbox Item id was
 * deliberately deleted so another client's queued create or update cannot
 * resurrect it. Tombstones are retained for 30 days and then purged; `deletedAt`
 * drives that retention window.
 */
export const inboxItemTombstone = pgTable("inbox_item_tombstone", {
  id: uuid("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * An Area owned by one account: a lightweight, optional label a Task can carry
 * for context. The primary key is the client-generated UUID, so an offline
 * record keeps its identity once it synchronizes; `version` and `idempotencyKey`
 * support safe retries and reviewable conflicts. Areas are created on entry from
 * the Task form and reused by name on the client, so no uniqueness constraint is
 * imposed here — that keeps offline records self-consistent without temporary-ID
 * remapping. The `account_name_idx` supports listing an account's Areas by name.
 */
export const area = pgTable(
  "area",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    idempotencyKey: uuid("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("area_account_name_idx").on(table.userId, table.name)],
);

/**
 * A Task owned by one account. The primary key is the client-generated UUID, so
 * an offline record keeps its identity once it synchronizes. `version` and
 * `idempotencyKey` support safe retries and reviewable conflicts for the
 * offline mutation tracer; `status` and `energy` are constrained `text` unions
 * rather than PostgreSQL enums. Planning metadata is all optional: a
 * `scheduled_date` with no `scheduled_time` is a date-only Task (no timed
 * reminder), `estimate_minutes` is informational, `important` is a plain Boolean,
 * and `area_id` references at most one Area (set null if that Area disappears).
 * Completion records `completedAt` but never a punitive state.
 */
export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("active"),
    scheduledDate: date("scheduled_date"),
    scheduledTime: text("scheduled_time"),
    estimateMinutes: integer("estimate_minutes"),
    energy: text("energy"),
    important: boolean("important").notNull().default(false),
    notes: text("notes").notNull().default(""),
    areaId: uuid("area_id").references(() => area.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    idempotencyKey: uuid("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("task_account_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index("task_account_scheduled_idx").on(
      table.userId,
      table.scheduledDate,
      table.id,
    ),
    index("task_account_status_area_created_idx").on(
      table.userId,
      table.status,
      table.areaId,
      table.createdAt,
      table.id,
    ),
    index("task_account_status_energy_created_idx").on(
      table.userId,
      table.status,
      table.energy,
      table.createdAt,
      table.id,
    ),
    index("task_area_idx").on(table.areaId),
  ],
);

/**
 * An app-owned deletion tombstone. It marks that a Task id was deliberately
 * deleted so another client's queued create or update cannot resurrect it.
 * Tombstones are retained for 30 days and then purged; `deletedAt` drives that
 * retention window.
 */
export const taskTombstone = pgTable("task_tombstone", {
  id: uuid("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The account's Focus Session. At most one may be active (running or paused) at a
 * time, enforced by the partial unique index on `user_id` over non-completed
 * rows; completion is terminal and the row is retained as minimal internal
 * history for a future user dashboard. Elapsed time is `accumulated_seconds`
 * (whole seconds folded from finished running segments) plus, while running, the
 * live delta since `last_resumed_at`, so the timer stays correct across pause,
 * navigation, and reopening on another device. The primary key is the
 * client-generated UUID, so an offline session keeps its identity once it
 * synchronizes; `version` and `idempotency_key` support safe retries and
 * reviewable conflicts. `distraction_count` is carried for the low-distraction
 * capture flow that builds on this session.
 */
export const focusSession = pgTable(
  "focus_session",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"),
    accumulatedSeconds: integer("accumulated_seconds").notNull().default(0),
    lastResumedAt: timestamp("last_resumed_at", { withTimezone: true }),
    distractionCount: integer("distraction_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    idempotencyKey: uuid("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The account-wide single-active invariant: at most one running-or-paused
    // session per account, so a second device cannot open a competing timer.
    uniqueIndex("focus_session_one_active_idx")
      .on(table.userId)
      .where(sql`status <> 'completed'`),
    // History lookups for the future dashboard, resolved newest first.
    index("focus_session_account_completed_idx").on(
      table.userId,
      table.completedAt,
    ),
  ],
);

/**
 * An Event owned by one account. Local timed Events are created in Rails without
 * Google Calendar access; imported Events are mirrored from Google, which stays
 * authoritative for them. Storage mirrors Google-compatible semantics so
 * synchronization needs no lossy translation: exact `start_at`/`end_at` instants
 * with their IANA time zones, an `is_all_day` flag with `date`-only bounds for
 * imported all-day Events, recurrence identity (`recurring_event_id`,
 * `recurrence` RRULE lines), a constrained `status`, and provider identifiers.
 * `origin` distinguishes local from synchronized Events. The primary key is the
 * client-generated UUID, so an offline record keeps its identity once it
 * synchronizes; `version` and `idempotency_key` support safe retries and
 * reviewable conflicts. The uniqueness constraint on
 * (`google_calendar_id`, `google_event_id`) prevents duplicate mirrors.
 */
export const event = pgTable(
  "event",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    startTimeZone: text("start_time_zone").notNull(),
    endTimeZone: text("end_time_zone").notNull(),
    isAllDay: boolean("is_all_day").notNull().default(false),
    allDayStartDate: date("all_day_start_date"),
    allDayEndDate: date("all_day_end_date"),
    recurringEventId: text("recurring_event_id"),
    recurrence: text("recurrence").array(),
    status: text("status").notNull().default("confirmed"),
    origin: text("origin").notNull().default("local"),
    googleCalendarId: text("google_calendar_id"),
    googleEventId: text("google_event_id"),
    version: integer("version").notNull().default(1),
    idempotencyKey: uuid("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Drives the weekly agenda and the cursor-paged Later list: scan an
    // account's Events in start order with a stable (start_at, id) tie-break.
    index("event_account_start_idx").on(table.userId, table.startAt, table.id),
    // One mirror per account per Google (calendar, event) pair prevents
    // duplication. Scoping by account keeps two users who share a Google
    // calendar from colliding on the same provider identity.
    uniqueIndex("event_account_google_identity_idx").on(
      table.userId,
      table.googleCalendarId,
      table.googleEventId,
    ),
  ],
);

/**
 * An Event deletion tombstone. It marks that an Event id was deliberately
 * deleted so another client's queued create or update cannot resurrect it.
 * Tombstones are retained for 30 days and then purged; `deleted_at` drives that
 * retention window.
 */
export const eventTombstone = pgTable("event_tombstone", {
  id: uuid("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The Event export outbox (MEM-42): the outbound counterpart to
 * {@link calendarSyncJob}. When Rails accepts a local Event mutation destined for
 * Google — a new local Event with a writable calendar, an edit to an already
 * mirrored Event, or a confirmed deletion — it records exactly one job here in
 * the same transaction as the mutation, then hands it to the durable Inngest
 * exporter. The unique `(user_id, event_id, operation)` index makes enqueue a
 * re-arm: a repeated mutation resets the existing job to `pending` instead of
 * piling up duplicates, and the exporter reads the Event's current state at run
 * time, so at most one `upsert` and one `delete` job ever exist per Event and a
 * retry never creates a duplicate Google Event. `operation` is a constrained
 * text union ("upsert" | "delete"); `google_calendar_id`/`google_event_id`
 * capture the write target and — for a delete, whose Event row is already gone —
 * the provider identity to remove. `status` is "pending" | "processing" |
 * "completed" | "failed" | "skipped"; `attempts` and `last_error_code` give
 * failure visibility without ever recording titles or provider payloads.
 */
export const eventExportJob = pgTable(
  "event_export_job",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Not a foreign key: a `delete` job must outlive the Event row it removes.
    eventId: uuid("event_id").notNull(),
    operation: text("operation").notNull(),
    googleCalendarId: text("google_calendar_id"),
    googleEventId: text("google_event_id"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One upsert job and one delete job per Event: a repeated mutation re-arms
    // the existing row to pending rather than enqueuing a second job.
    uniqueIndex("event_export_job_identity_idx").on(
      table.userId,
      table.eventId,
      table.operation,
    ),
    // Drains the outbox oldest-first over the pending rows.
    index("event_export_job_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
  ],
);

/**
 * A Thought owned by one account: lightweight, searchable, non-actionable
 * reference material. `source_inbox_item_id` records the Inbox Item it was
 * classified from, if any. Soft-deleted via `deleted_at` with a purge index.
 */
export const thought = pgTable(
  "thought",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    sourceInboxItemId: uuid("source_inbox_item_id").references(
      () => inboxItem.id,
      { onDelete: "set null" },
    ),
    version: integer("version").notNull().default(1),
    lastMutationKey: uuid("last_mutation_key").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("thought_account_updated_idx").on(
      table.userId,
      table.updatedAt,
      table.id,
    ),
    index("thought_tombstone_purge_idx").on(table.deletedAt),
  ],
);

/**
 * One account's Google Calendar connection. A row exists only while Calendar
 * access is granted, so its presence is the connection itself — disconnecting
 * deletes it and never touches the account or its login. The refresh token is
 * stored only as authenticated ciphertext: `refresh_token_ciphertext`,
 * `refresh_token_nonce`, and `refresh_token_auth_tag` are the AES-256-GCM
 * outputs and `refresh_token_key_version` records which key sealed them, so keys
 * can rotate without re-encryption. Plaintext tokens never reach a column, a
 * response, or a log. `status` is a constrained text union ("connected" |
 * "needs_reauth"). `primary_calendar_id`/`primary_time_zone` capture the
 * primary calendar for the timezone offer.
 */
export const calendarConnection = pgTable("calendar_connection", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("connected"),
  googleAccountId: text("google_account_id"),
  scope: text("scope").notNull(),
  refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
  refreshTokenNonce: text("refresh_token_nonce").notNull(),
  refreshTokenAuthTag: text("refresh_token_auth_tag").notNull(),
  refreshTokenKeyVersion: integer("refresh_token_key_version").notNull(),
  primaryCalendarId: text("primary_calendar_id"),
  primaryTimeZone: text("primary_time_zone"),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A calendar the account has an opinion about: whether it is visible in the
 * agenda and whether it is the single writable destination for Rails-created
 * Events. Rows are a snapshot taken at connect time (summary, access role, and
 * timezone from Google's calendar list) so Settings can render without a live
 * Google read. The partial unique index enforces the account-wide invariant
 * that at most one calendar is writable; `access_role` is snapshotted so a
 * read-only calendar can never be promoted to a write destination offline.
 */
export const calendarSelection = pgTable(
  "calendar_selection",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    summary: text("summary").notNull(),
    accessRole: text("access_role").notNull(),
    timeZone: text("time_zone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    isVisible: boolean("is_visible").notNull().default(true),
    isWritable: boolean("is_writable").notNull().default(false),
    // Per-calendar import bookkeeping. `sync_token` is Google's opaque cursor
    // captured on the final import page, so the incremental sync (MEM-41) can
    // resume from exactly where the initial mirror ended; `last_synced_at`
    // records when the mirror last reflected this calendar and drives the
    // agenda's last-synchronized cue.
    syncToken: text("sync_token"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    // Per-calendar push-notification watch (MEM-41). Each calendar owns its own
    // channel independently: `watch_channel_id` is the id Rails chose when
    // opening the watch and the key an incoming notification is matched on;
    // `watch_resource_id` is Google's stable id for the watched resource;
    // `watch_token` is the opaque verification token a notification must present
    // before any sync runs; `watch_expires_at` drives proactive renewal before
    // Google stops delivering. All null until a watch is registered.
    watchChannelId: text("watch_channel_id"),
    watchResourceId: text("watch_resource_id"),
    watchToken: text("watch_token"),
    watchExpiresAt: timestamp("watch_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("calendar_selection_account_calendar_idx").on(
      table.userId,
      table.googleCalendarId,
    ),
    // At most one writable calendar per account: an unambiguous write target.
    uniqueIndex("calendar_selection_one_writable_idx")
      .on(table.userId)
      .where(sql`is_writable`),
    // A watch channel id is globally unique, so an incoming notification resolves
    // to exactly one account's calendar. Partial so unwatched calendars (null)
    // do not collide.
    uniqueIndex("calendar_selection_watch_channel_idx")
      .on(table.watchChannelId)
      .where(sql`watch_channel_id is not null`),
  ],
);

/**
 * The Calendar synchronization outbox (MEM-41). A verified webhook, in the same
 * transaction that acknowledges it, records exactly one row here per delivered
 * notification and returns 200 without touching Google inline. A dispatcher then
 * drains `pending` rows to Inngest, which runs the durable, paginated
 * incremental sync. The unique `(channel_id, message_number)` index makes
 * duplicate delivery a no-op insert — Google re-sends a notification until it is
 * acknowledged, and this guarantees a re-send never enqueues a second job.
 * `status` is a constrained text union ("pending" | "processing" | "completed" |
 * "failed"); `attempts` and `last_error_code` give failure visibility without
 * ever recording provider payloads or user content.
 */
export const calendarSyncJob = pgTable(
  "calendar_sync_job",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    channelId: text("channel_id").notNull(),
    messageNumber: integer("message_number").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Duplicate delivery is a no-op: Google re-sends until acknowledged, and the
    // same (channel, message number) can only ever create one job.
    uniqueIndex("calendar_sync_job_delivery_idx").on(
      table.channelId,
      table.messageNumber,
    ),
    // Drains the outbox oldest-first over the pending rows.
    index("calendar_sync_job_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
  ],
);

/**
 * Account-wide reminder choices. Browser subscriptions are deliberately stored
 * separately because each browser/device can be enabled or removed on its own.
 * A missing row resolves to the domain defaults.
 */
export const reminderPreference = pgTable("reminder_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  headsUpEnabled: boolean("heads_up_enabled").notNull().default(true),
  leadMinutes: integer("lead_minutes").notNull().default(10),
  atTimeEnabled: boolean("at_time_enabled").notNull().default(false),
  eventCueEnabled: boolean("event_cue_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One standard VAPID subscription for one browser profile. The endpoint and
 * encryption keys are provider-issued credentials, remain server-only, and are
 * never included in logs or push payloads.
 */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    expirationTime: timestamp("expiration_time", { withTimezone: true }),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("push_subscription_endpoint_idx").on(table.endpoint),
    index("push_subscription_account_idx").on(table.userId, table.id),
  ],
);

/**
 * Per-device idempotency and retry state for timed Task reminders. The unique
 * key means a scheduler retry cannot notify the same browser twice for the same
 * Task moment, while another browser retains its own independent delivery.
 */
export const taskReminderDelivery = pgTable(
  "task_reminder_delivery",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => pushSubscription.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("processing"),
    attempts: integer("attempts").notNull().default(1),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("task_reminder_delivery_once_idx").on(
      table.subscriptionId,
      table.taskId,
      table.kind,
      table.scheduledFor,
    ),
    index("task_reminder_delivery_retry_idx").on(
      table.status,
      table.nextAttemptAt,
      table.id,
    ),
  ],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
