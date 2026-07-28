import { z } from "zod";

import {
  type ConnectionResponse,
  type SelectedCalendar,
  type SelectionValidation,
  defaultSelection,
  primaryTimeZoneOf,
  saveSelectionRequestSchema,
  validateSelection,
} from "@/domain/calendar/connection";

import type { GoogleCalendarAuthAdapter } from "./google-adapter";
import type { CalendarRepository } from "./repository";
import type { TokenCipher } from "./token-cipher";

export interface CalendarServiceDependencies {
  repository: CalendarRepository;
  adapter: GoogleCalendarAuthAdapter;
  cipher: TokenCipher;
}

export type CompleteAuthorizationResult =
  | { ok: true }
  | { ok: false; reason: "exchange_failed" };

export type SaveSelectionResult =
  | { ok: true; calendars: SelectedCalendar[] }
  | { ok: false; reason: "not_connected" }
  | {
      ok: false;
      reason: "invalid_shape";
      fieldErrors: Record<string, string[]>;
    }
  | {
      ok: false;
      reason: "invalid";
      validation: Extract<SelectionValidation, { ok: false }>;
    };

export interface DisconnectResult {
  wasConnected: boolean;
}

/**
 * Owns the connect-and-configure use cases (MEM-39): turn an OAuth grant into an
 * encrypted, account-scoped Calendar connection; expose the connection and its
 * calendars; apply a validated visibility/writable selection; and tear the
 * connection down on disconnect. It composes the Google adapter (I/O boundary),
 * the token cipher (encryption at rest), and the repository (persistence).
 * Route handlers translate its outcomes to HTTP; login is never affected here.
 */
export function createCalendarService(deps: CalendarServiceDependencies) {
  const { repository, adapter, cipher } = deps;

  return {
    /** The Google consent URL for the incremental Calendar grant. */
    buildAuthorizationUrl(state: string): string {
      return adapter.buildAuthorizationUrl({ state });
    },

    /**
     * Exchanges an authorization code, encrypts the refresh token, snapshots the
     * account's calendars with a sensible default selection, and persists the
     * connection. A failed exchange or calendar read leaves no connection behind.
     */
    async completeAuthorization(
      userId: string,
      code: string,
    ): Promise<CompleteAuthorizationResult> {
      let refreshToken: string;
      let scope: string;
      let googleAccountId: string | null;
      let calendars: SelectedCalendar[];
      let primaryCalendarId: string | null;
      let primaryTimeZone: string | null;

      try {
        const grant = await adapter.exchangeCode({ code });
        const available = await adapter.listCalendars({
          accessToken: grant.accessToken,
        });
        refreshToken = grant.refreshToken;
        scope = grant.scope;
        googleAccountId = grant.googleAccountId;
        calendars = defaultSelection(available);
        primaryCalendarId =
          available.find((c) => c.primary)?.googleCalendarId ?? null;
        primaryTimeZone = primaryTimeZoneOf(available);
      } catch {
        return { ok: false, reason: "exchange_failed" };
      }

      await repository.saveConnection(userId, {
        status: "connected",
        googleAccountId,
        scope,
        encryptedRefreshToken: cipher.encrypt(refreshToken),
        primaryCalendarId,
        primaryTimeZone,
        calendars,
      });

      return { ok: true };
    },

    /** The connection and its calendars, or null when Calendar is not connected. */
    async getConnection(userId: string): Promise<ConnectionResponse | null> {
      const connection = await repository.getConnection(userId);
      if (!connection) {
        return null;
      }

      const calendars = await repository.listCalendars(userId);
      const lastSyncedAt = await repository.latestSyncAt(userId);
      return {
        status: connection.status,
        primaryCalendarId: connection.primaryCalendarId,
        primaryTimeZone: connection.primaryTimeZone,
        connectedAt: connection.connectedAt.toISOString(),
        lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
        calendars,
      };
    },

    /**
     * Applies a visibility/writable selection after validating it against the
     * account's stored calendars, so a read-only calendar can never become the
     * write target and at most one calendar is ever writable.
     */
    async saveSelection(
      userId: string,
      rawInput: unknown,
    ): Promise<SaveSelectionResult> {
      const parsed = saveSelectionRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid_shape",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        };
      }

      const connection = await repository.getConnection(userId);
      if (!connection) {
        return { ok: false, reason: "not_connected" };
      }

      const available = await repository.listCalendars(userId);
      const validation = validateSelection(available, parsed.data.selections);
      if (!validation.ok) {
        return { ok: false, reason: "invalid", validation };
      }

      await repository.replaceSelection(userId, parsed.data.selections);
      return { ok: true, calendars: await repository.listCalendars(userId) };
    },

    /**
     * Disconnects Calendar: best-effort revoke of the Google grant, then delete
     * the local connection and calendar snapshot. Local Events and the account
     * itself are left untouched, and nothing is exported.
     */
    async disconnect(userId: string): Promise<DisconnectResult> {
      const connection = await repository.getConnection(userId);
      if (!connection) {
        return { wasConnected: false };
      }

      try {
        await adapter.revoke({
          token: cipher.decrypt(connection.encryptedRefreshToken),
        });
      } catch {
        // A failed or unnecessary revocation must not block local teardown.
      }

      await repository.deleteConnection(userId);
      return { wasConnected: true };
    },
  };
}

export type CalendarService = ReturnType<typeof createCalendarService>;
