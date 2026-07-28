import { and, asc, desc, eq, isNotNull, max } from "drizzle-orm";

import type {
  CalendarAccessRole,
  CalendarSelectionEntry,
  ConnectionStatus,
  SelectedCalendar,
} from "@/domain/calendar/connection";
import type { Database } from "@/server/db/connection";
import { calendarConnection, calendarSelection } from "@/server/db/schema";

import type { EncryptedToken } from "./token-cipher";

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

    /** Deletes the connection and its calendar snapshot. Login is untouched. */
    async deleteConnection(userId: string): Promise<void> {
      await database.transaction(async (tx) => {
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

export type CalendarRepository = ReturnType<typeof createCalendarRepository>;
