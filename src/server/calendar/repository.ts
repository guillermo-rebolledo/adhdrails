import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  max,
  or,
} from "drizzle-orm";

import type {
  CalendarAccessRole,
  CalendarSelectionEntry,
  ConnectionStatus,
  SelectedCalendar,
} from "@/domain/calendar/connection";
import type { Database } from "@/server/db/connection";
import {
  calendarConnection,
  calendarSelection,
  calendarSyncJob,
  eventExportJob,
} from "@/server/db/schema";

import type { EncryptedToken } from "./token-cipher";

/**
 * The per-calendar synchronization state the incremental sync (MEM-41) needs: the
 * resume cursor and the push-notification watch, alongside the identity and
 * timezone the mirror mapping uses. Read by calendar or by watch channel.
 */
export interface CalendarSyncRecord {
  userId: string;
  googleCalendarId: string;
  summary: string;
  timeZone: string | null;
  isVisible: boolean;
  syncToken: string | null;
  watchChannelId: string | null;
  watchResourceId: string | null;
  watchToken: string | null;
  watchExpiresAt: Date | null;
}

/** The watch metadata Google returns when a channel is opened. */
export interface SaveWatchInput {
  channelId: string;
  resourceId: string;
  token: string;
  expiresAt: Date | null;
}

/** The stored connection row, with the encrypted token grouped for the cipher. */
export interface ConnectionRecord {
  userId: string;
  status: ConnectionStatus;
  googleAccountId: string | null;
  scope: string;
  encryptedRefreshToken: EncryptedToken;
  primaryCalendarId: string | null;
  primaryTimeZone: string | null;
  connectedAt: Date;
}

/** Everything needed to persist a fresh connection plus its calendar snapshot. */
export interface SaveConnectionInput {
  status: ConnectionStatus;
  googleAccountId: string | null;
  scope: string;
  encryptedRefreshToken: EncryptedToken;
  primaryCalendarId: string | null;
  primaryTimeZone: string | null;
  calendars: SelectedCalendar[];
}

function toConnectionRecord(row: {
  userId: string;
  status: string;
  googleAccountId: string | null;
  scope: string;
  refreshTokenCiphertext: string;
  refreshTokenNonce: string;
  refreshTokenAuthTag: string;
  refreshTokenKeyVersion: number;
  primaryCalendarId: string | null;
  primaryTimeZone: string | null;
  connectedAt: Date;
}): ConnectionRecord {
  return {
    userId: row.userId,
    status: row.status as ConnectionStatus,
    googleAccountId: row.googleAccountId,
    scope: row.scope,
    encryptedRefreshToken: {
      ciphertext: row.refreshTokenCiphertext,
      nonce: row.refreshTokenNonce,
      authTag: row.refreshTokenAuthTag,
      keyVersion: row.refreshTokenKeyVersion,
    },
    primaryCalendarId: row.primaryCalendarId,
    primaryTimeZone: row.primaryTimeZone,
    connectedAt: row.connectedAt,
  };
}

function toSyncRecord(row: {
  userId: string;
  googleCalendarId: string;
  summary: string;
  timeZone: string | null;
  isVisible: boolean;
  syncToken: string | null;
  watchChannelId: string | null;
  watchResourceId: string | null;
  watchToken: string | null;
  watchExpiresAt: Date | null;
}): CalendarSyncRecord {
  return {
    userId: row.userId,
    googleCalendarId: row.googleCalendarId,
    summary: row.summary,
    timeZone: row.timeZone,
    isVisible: row.isVisible,
    syncToken: row.syncToken,
    watchChannelId: row.watchChannelId,
    watchResourceId: row.watchResourceId,
    watchToken: row.watchToken,
    watchExpiresAt: row.watchExpiresAt,
  };
}

const syncRecordColumns = {
  userId: calendarSelection.userId,
  googleCalendarId: calendarSelection.googleCalendarId,
  summary: calendarSelection.summary,
  timeZone: calendarSelection.timeZone,
  isVisible: calendarSelection.isVisible,
  syncToken: calendarSelection.syncToken,
  watchChannelId: calendarSelection.watchChannelId,
  watchResourceId: calendarSelection.watchResourceId,
  watchToken: calendarSelection.watchToken,
  watchExpiresAt: calendarSelection.watchExpiresAt,
};

function toSelectedCalendar(row: {
  googleCalendarId: string;
  summary: string;
  accessRole: string;
  timeZone: string | null;
  isPrimary: boolean;
  isVisible: boolean;
  isWritable: boolean;
}): SelectedCalendar {
  return {
    googleCalendarId: row.googleCalendarId,
    summary: row.summary,
    accessRole: row.accessRole as CalendarAccessRole,
    timeZone: row.timeZone,
    primary: row.isPrimary,
    isVisible: row.isVisible,
    isWritable: row.isWritable,
  };
}

/**
 * Account-scoped access to the Calendar connection and its selected calendars.
 * Every operation is keyed by `userId`, so a caller can only ever read or write
 * its own account's connection. Foreign keys and these ownership predicates
 * enforce tenancy; the partial unique index enforces the single-writable rule.
 */
export function createCalendarRepository(database: Database) {
  return {
    async getConnection(userId: string): Promise<ConnectionRecord | null> {
      const [row] = await database
        .select()
        .from(calendarConnection)
        .where(eq(calendarConnection.userId, userId))
        .limit(1);

      return row ? toConnectionRecord(row) : null;
    },

    async listCalendars(userId: string): Promise<SelectedCalendar[]> {
      const rows = await database
        .select()
        .from(calendarSelection)
        .where(eq(calendarSelection.userId, userId))
        // Stable UI order: the primary calendar first, then alphabetical, with
        // the calendar id as a deterministic tie-break.
        .orderBy(
          desc(calendarSelection.isPrimary),
          asc(calendarSelection.summary),
          asc(calendarSelection.googleCalendarId),
        );

      return rows.map(toSelectedCalendar);
    },

    /**
     * Replaces any existing connection and calendar snapshot with a fresh grant,
     * in one transaction. A reconnect therefore fully supersedes the prior state
     * rather than merging into it.
     */
    async saveConnection(
      userId: string,
      input: SaveConnectionInput,
    ): Promise<void> {
      const now = new Date();
      const connectionValues = {
        status: input.status,
        googleAccountId: input.googleAccountId,
        scope: input.scope,
        refreshTokenCiphertext: input.encryptedRefreshToken.ciphertext,
        refreshTokenNonce: input.encryptedRefreshToken.nonce,
        refreshTokenAuthTag: input.encryptedRefreshToken.authTag,
        refreshTokenKeyVersion: input.encryptedRefreshToken.keyVersion,
        primaryCalendarId: input.primaryCalendarId,
        primaryTimeZone: input.primaryTimeZone,
        connectedAt: now,
        updatedAt: now,
      };

      await database.transaction(async (tx) => {
        await tx
          .delete(calendarSelection)
          .where(eq(calendarSelection.userId, userId));

        await tx
          .insert(calendarConnection)
          .values({ userId, ...connectionValues })
          .onConflictDoUpdate({
            target: calendarConnection.userId,
            set: connectionValues,
          });

        if (input.calendars.length > 0) {
          await tx.insert(calendarSelection).values(
            input.calendars.map((calendar) => ({
              id: crypto.randomUUID(),
              userId,
              googleCalendarId: calendar.googleCalendarId,
              summary: calendar.summary,
              accessRole: calendar.accessRole,
              timeZone: calendar.timeZone,
              isPrimary: calendar.primary,
              isVisible: calendar.isVisible,
              isWritable: calendar.isWritable,
            })),
          );
        }
      });
    },

    /**
     * Applies a new visibility/writable choice to the stored calendars. Writes
     * writable-off before writable-on so the single-writable partial unique
     * index never trips while the write target moves between calendars.
     */
    async replaceSelection(
      userId: string,
      selections: readonly CalendarSelectionEntry[],
    ): Promise<void> {
      const applyOne = (
        tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
        selection: CalendarSelectionEntry,
      ) =>
        tx
          .update(calendarSelection)
          .set({
            isVisible: selection.isVisible,
            isWritable: selection.isWritable,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(calendarSelection.userId, userId),
              eq(
                calendarSelection.googleCalendarId,
                selection.googleCalendarId,
              ),
            ),
          );

      await database.transaction(async (tx) => {
        // Clear writable-off before writable-on so the single-writable partial
        // unique index never trips while the write target moves calendars.
        for (const selection of selections.filter((s) => !s.isWritable)) {
          await applyOne(tx, selection);
        }
        for (const selection of selections.filter((s) => s.isWritable)) {
          await applyOne(tx, selection);
        }
      });
    },

    /**
     * Records the outcome of importing one calendar: the opaque Google sync
     * cursor to resume from and the instant the mirror last reflected it. Keyed
     * by the account and calendar, so it never touches another account's rows.
     */
    async recordCalendarSync(
      userId: string,
      googleCalendarId: string,
      input: { syncToken: string | null; lastSyncedAt: Date },
    ): Promise<void> {
      await database
        .update(calendarSelection)
        .set({
          syncToken: input.syncToken,
          lastSyncedAt: input.lastSyncedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(calendarSelection.userId, userId),
            eq(calendarSelection.googleCalendarId, googleCalendarId),
          ),
        );
    },

    /**
     * The account's single writable calendar as an export destination, or null
     * if none is selected. The partial unique index guarantees at most one, so a
     * Rails-created Event always has an unambiguous target (MEM-42).
     */
    async getWritableCalendar(
      userId: string,
    ): Promise<{ googleCalendarId: string } | null> {
      const [row] = await database
        .select({ googleCalendarId: calendarSelection.googleCalendarId })
        .from(calendarSelection)
        .where(
          and(
            eq(calendarSelection.userId, userId),
            eq(calendarSelection.isWritable, true),
          ),
        )
        .limit(1);

      return row ?? null;
    },

    /** One calendar's sync state (cursor + watch), or null if the account has none. */
    async getCalendar(
      userId: string,
      googleCalendarId: string,
    ): Promise<CalendarSyncRecord | null> {
      const [row] = await database
        .select(syncRecordColumns)
        .from(calendarSelection)
        .where(
          and(
            eq(calendarSelection.userId, userId),
            eq(calendarSelection.googleCalendarId, googleCalendarId),
          ),
        )
        .limit(1);

      return row ? toSyncRecord(row) : null;
    },

    /**
     * Resolves an incoming notification's watch channel to the calendar it
     * belongs to. This is the one read not scoped by account: the webhook has no
     * session, so it authenticates the caller by matching the stored watch token
     * against the notification's token. Channel ids are globally unique (a
     * partial unique index), so at most one calendar can match.
     */
    async getCalendarByChannel(
      channelId: string,
    ): Promise<CalendarSyncRecord | null> {
      const [row] = await database
        .select(syncRecordColumns)
        .from(calendarSelection)
        .where(eq(calendarSelection.watchChannelId, channelId))
        .limit(1);

      return row ? toSyncRecord(row) : null;
    },

    /** The account's visible calendars' sync state, for watch renewal sweeps. */
    async listVisibleCalendarSyncState(
      userId: string,
    ): Promise<CalendarSyncRecord[]> {
      const rows = await database
        .select(syncRecordColumns)
        .from(calendarSelection)
        .where(
          and(
            eq(calendarSelection.userId, userId),
            eq(calendarSelection.isVisible, true),
          ),
        )
        .orderBy(asc(calendarSelection.googleCalendarId));

      return rows.map(toSyncRecord);
    },

    /** Records the watch channel Google opened for one calendar. */
    async saveWatch(
      userId: string,
      googleCalendarId: string,
      input: SaveWatchInput,
    ): Promise<void> {
      await database
        .update(calendarSelection)
        .set({
          watchChannelId: input.channelId,
          watchResourceId: input.resourceId,
          watchToken: input.token,
          watchExpiresAt: input.expiresAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(calendarSelection.userId, userId),
            eq(calendarSelection.googleCalendarId, googleCalendarId),
          ),
        );
    },

    /**
     * The most recent instant any of the account's calendars was synchronized,
     * or null before the first import. Drives the connection-level
     * last-synchronized cue the agenda shows.
     */
    async latestSyncAt(userId: string): Promise<Date | null> {
      const [row] = await database
        .select({ latest: max(calendarSelection.lastSyncedAt) })
        .from(calendarSelection)
        .where(
          and(
            eq(calendarSelection.userId, userId),
            isNotNull(calendarSelection.lastSyncedAt),
          ),
        );

      return row?.latest ?? null;
    },

    /**
     * Every account with a live Calendar connection, oldest account id first.
     * Drives the periodic maintenance sweeps (MEM-43) — watch renewal and mirror
     * cleanup — which iterate connected accounts rather than reacting to a single
     * request.
     */
    async listConnectedUserIds(): Promise<string[]> {
      const rows = await database
        .select({ userId: calendarConnection.userId })
        .from(calendarConnection)
        .where(eq(calendarConnection.status, "connected"))
        .orderBy(asc(calendarConnection.userId));

      return rows.map((row) => row.userId);
    },

    /**
     * The visible calendars of connected accounts that have not synced since
     * `before` (never-synced calendars included). Drives periodic reconciliation
     * (MEM-43): a calendar is only returned once its last successful sync has
     * aged past the staleness cutoff, which happens when its watch expired or a
     * notification was missed — exactly the calendars reconciliation must resync.
     */
    async listCalendarsDueForReconciliation(
      before: Date,
    ): Promise<{ userId: string; googleCalendarId: string }[]> {
      return database
        .select({
          userId: calendarSelection.userId,
          googleCalendarId: calendarSelection.googleCalendarId,
        })
        .from(calendarSelection)
        .innerJoin(
          calendarConnection,
          eq(calendarConnection.userId, calendarSelection.userId),
        )
        .where(
          and(
            eq(calendarConnection.status, "connected"),
            eq(calendarSelection.isVisible, true),
            or(
              isNull(calendarSelection.lastSyncedAt),
              lt(calendarSelection.lastSyncedAt, before),
            ),
          ),
        )
        .orderBy(
          asc(calendarSelection.userId),
          asc(calendarSelection.googleCalendarId),
        );
    },

    /**
     * The account's calendars that currently hold an open push-notification
     * watch, so disconnect can stop each channel on Google before it revokes the
     * grant. Only calendars with a stored channel are returned.
     */
    async listWatchedCalendars(userId: string): Promise<WatchedCalendar[]> {
      const rows = await database
        .select({
          googleCalendarId: calendarSelection.googleCalendarId,
          watchChannelId: calendarSelection.watchChannelId,
          watchResourceId: calendarSelection.watchResourceId,
        })
        .from(calendarSelection)
        .where(
          and(
            eq(calendarSelection.userId, userId),
            isNotNull(calendarSelection.watchChannelId),
            isNotNull(calendarSelection.watchResourceId),
          ),
        )
        .orderBy(asc(calendarSelection.googleCalendarId));

      return rows.flatMap((row) =>
        row.watchChannelId && row.watchResourceId
          ? [
              {
                googleCalendarId: row.googleCalendarId,
                watchChannelId: row.watchChannelId,
                watchResourceId: row.watchResourceId,
              },
            ]
          : [],
      );
    },

    /**
     * Deletes the connection, its calendar snapshot (which carries the local
     * watch bookkeeping), and every queued Calendar sync/export job for the
     * account, in one transaction. Login and local Events are untouched; the
     * cleared jobs mean no drain runs orphaned Calendar work after disconnect.
     */
    async deleteConnection(userId: string): Promise<void> {
      await database.transaction(async (tx) => {
        await tx
          .delete(calendarSyncJob)
          .where(eq(calendarSyncJob.userId, userId));
        await tx
          .delete(eventExportJob)
          .where(eq(eventExportJob.userId, userId));
        await tx
          .delete(calendarSelection)
          .where(eq(calendarSelection.userId, userId));
        await tx
          .delete(calendarConnection)
          .where(eq(calendarConnection.userId, userId));
      });
    },
  };
}

/** A calendar with an open Google watch channel, for disconnect teardown. */
export interface WatchedCalendar {
  googleCalendarId: string;
  watchChannelId: string;
  watchResourceId: string;
}

export type CalendarRepository = ReturnType<typeof createCalendarRepository>;
