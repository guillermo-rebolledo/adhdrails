"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";

import type { DataExportStatusResponse } from "@/domain/account/data-export";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  type AccountDeletionStatusResponse,
} from "@/domain/account/deletion";
import { problemDetail } from "@/domain/http/problem";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api-client";
import { getClientDatabase } from "@/offline/db";

import { SETTINGS_SECTION_CLASS_NAME } from "./settings-section";

/** How often to re-check a preparing export. Calm, not chatty. */
const POLL_INTERVAL_MS = 2500;

interface DataPrivacySettingsProps {
  initialStatus: DataExportStatusResponse;
  accountId?: string;
  onDeletionConfirmed?: () => void | Promise<void>;
}

function isPreparing(status: DataExportStatusResponse["status"]): boolean {
  return status === "pending" || status === "processing";
}

/**
 * The Settings "Data & Privacy" section (MEM-48). It lets a user take their
 * app-owned data with them: request a durable export, watch it move through
 * pending → ready without blocking anything else, and download the JSON archive
 * while it is available. Mirrored Google Calendar data is never part of it.
 */
export function DataPrivacySettings({
  initialStatus,
  accountId = "current",
  onDeletionConfirmed,
}: DataPrivacySettingsProps) {
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [deletionAccepted, setDeletionAccepted] = useState(false);
  const preparing = isPreparing(status.status);

  // Poll while an export is preparing, then stop as soon as it resolves, so the
  // download appears without the user refreshing and nothing polls at rest.
  useEffect(() => {
    if (!preparing) {
      return;
    }

    let active = true;
    const timer = setInterval(async () => {
      const response = await apiRequest<DataExportStatusResponse>(
        "/api/v1/account/data-export",
      ).catch(() => null);
      if (active && response?.ok && response.body) {
        setStatus(response.body);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [preparing]);

  async function requestExport() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<DataExportStatusResponse>(
        "/api/v1/account/data-export",
        { method: "POST" },
      );
      if (!response.ok || !response.body) {
        setError(
          problemDetail(
            response.body,
            "We couldn't start your export. Please try again.",
          ),
        );
        return;
      }
      setStatus(response.body);
    } catch {
      // fetch rejects when offline; keep the message calm and actionable.
      setError(
        "You appear to be offline. Reconnect to export your data — the rest of Rails keeps working.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestDeletion() {
    if (confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
      return;
    }

    setDeletionBusy(true);
    setDeletionError(null);
    let accepted: AccountDeletionStatusResponse;
    try {
      const response = await apiRequest<AccountDeletionStatusResponse>(
        "/api/v1/account/deletion",
        {
          method: "POST",
          body: JSON.stringify({ confirmation }),
        },
      );
      if (!response.ok || !response.body) {
        setDeletionError(
          problemDetail(
            response.body,
            "We couldn't confirm account deletion. Your account is still available; please try again.",
          ),
        );
        return;
      }
      accepted = response.body;
    } catch {
      setDeletionError(
        "You appear to be offline. Reconnect before deleting your account.",
      );
      setDeletionBusy(false);
      return;
    }

    // From this point onward access is already disabled. Local cleanup must not
    // turn a successful server acceptance into a false “try again” message.
    setDeletionAccepted(true);
    if (onDeletionConfirmed) {
      await Promise.resolve(onDeletionConfirmed()).catch(() => undefined);
      setDeletionBusy(false);
      return;
    }

    await getClientDatabase(accountId)
      .delete()
      .catch(() => undefined);
    const target = new URL("/signin", window.location.origin);
    target.searchParams.set("account-deletion", "confirmed");
    target.searchParams.set("deletion", accepted.id);
    window.location.assign(target.toString());
  }

  return (
    <section
      aria-labelledby="data-privacy-title"
      className={SETTINGS_SECTION_CLASS_NAME}
      id="data-privacy"
    >
      <h2 id="data-privacy-title" className="text-lg font-medium">
        Data &amp; Privacy
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Rails keeps app-owned content separate from mirrored Google Calendar
        data and never uses your content for session replay.
      </p>

      <div className="mt-5 flex flex-col gap-3 rounded-lg border bg-background/50 p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Export your data</h3>
          <p className="text-sm text-muted-foreground">
            Download your Inbox, Tasks, Thoughts, local Events, Areas,
            preferences, and focus history as JSON. Mirrored Google Calendar
            data is not included.
          </p>
        </div>

        <DataExportState status={status} />

        <div className="flex flex-wrap items-center gap-3">
          {status.status === "completed" ? (
            // A real navigation to the download endpoint (not a client route):
            // the response streams a JSON attachment via Content-Disposition.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a
              className={buttonVariants({ variant: "default", size: "sm" })}
              href="/api/v1/account/data-export/download"
              data-testid="download-export"
            >
              <DownloadIcon aria-hidden="true" className="size-4" />
              Download export
            </a>
          ) : null}

          <Button
            variant={status.status === "none" ? "default" : "outline"}
            size="sm"
            onClick={requestExport}
            disabled={busy || preparing}
            data-testid="request-export"
          >
            {requestExportLabel(status.status, busy, preparing)}
          </Button>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <Link
        className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
        href="/privacy"
      >
        Read how Rails handles data
        <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
      </Link>

      <div className="mt-5 flex flex-col gap-3 rounded-lg border bg-background/50 p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Delete your account</h3>
          <p className="text-sm text-muted-foreground">
            This signs you out, revokes connected Google access, stops
            reminders, and permanently removes your Rails content. This cannot
            be undone.
          </p>
        </div>

        {!deletionOpen ? (
          <Button
            className="w-fit bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:text-black dark:hover:bg-destructive/90"
            variant="destructive"
            size="sm"
            onClick={() => setDeletionOpen(true)}
          >
            Delete account
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <label
              className="text-sm font-medium"
              htmlFor="account-deletion-confirmation"
            >
              Type {ACCOUNT_DELETION_CONFIRMATION} to confirm
            </label>
            <Input
              id="account-deletion-confirmation"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                className="bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:text-black dark:hover:bg-destructive/90"
                variant="destructive"
                size="sm"
                disabled={
                  deletionBusy || confirmation !== ACCOUNT_DELETION_CONFIRMATION
                }
                onClick={requestDeletion}
              >
                {deletionBusy ? "Confirming…" : "Permanently delete account"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={deletionBusy}
                onClick={() => {
                  setDeletionOpen(false);
                  setConfirmation("");
                  setDeletionError(null);
                }}
              >
                Cancel
              </Button>
            </div>
            {deletionError ? (
              <p role="alert" className="text-sm text-destructive">
                {deletionError}
              </p>
            ) : null}
            {deletionAccepted ? (
              <p role="status" className="text-sm text-muted-foreground">
                Account deletion was confirmed. Access is disabled while
                permanent cleanup finishes.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function requestExportLabel(
  status: DataExportStatusResponse["status"],
  busy: boolean,
  preparing: boolean,
): string {
  if (busy) {
    return "Starting…";
  }
  if (preparing) {
    return "Preparing…";
  }
  if (status === "completed") {
    return "Refresh export";
  }
  if (status === "failed" || status === "expired") {
    return "Export again";
  }
  return "Export your data";
}

function DataExportState({ status }: { status: DataExportStatusResponse }) {
  if (status.status === "none") {
    return null;
  }

  if (isPreparing(status.status)) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Preparing your export. This keeps working in the background — you can
        leave this page.
      </p>
    );
  }

  if (status.status === "completed") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Your export is ready
        {status.expiresAt
          ? `, available until ${new Date(status.expiresAt).toLocaleString()}`
          : ""}
        .
      </p>
    );
  }

  if (status.status === "expired") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Your last export has expired. Prepare a new one whenever you need it.
      </p>
    );
  }

  return (
    <p role="status" className="text-sm text-muted-foreground">
      Your last export didn&apos;t finish. Try again when you&apos;re ready.
    </p>
  );
}
