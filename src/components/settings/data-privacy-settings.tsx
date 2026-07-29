"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";

import type { DataExportStatusResponse } from "@/domain/account/data-export";
import { problemDetail } from "@/domain/http/problem";
import { Button, buttonVariants } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";

import { SETTINGS_SECTION_CLASS_NAME } from "./settings-section";

/** How often to re-check a preparing export. Calm, not chatty. */
const POLL_INTERVAL_MS = 2500;

interface DataPrivacySettingsProps {
  initialStatus: DataExportStatusResponse;
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
}: DataPrivacySettingsProps) {
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
