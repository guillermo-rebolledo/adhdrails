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
 * A Task owned by one account. The primary key is the client-generated UUID, so
 * an offline record keeps its identity once it synchronizes. `version` and
 * `idempotencyKey` support safe retries and reviewable conflicts for the
 * offline mutation tracer; `status` is a constrained `text` union rather than a
 * PostgreSQL enum. Completion records `completedAt` but never a punitive state.
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
    // One mirror per Google (calendar, event) pair prevents duplication.
    uniqueIndex("event_google_identity_idx").on(
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
