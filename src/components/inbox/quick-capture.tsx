"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INBOX_TITLE_MAX_LENGTH } from "@/domain/inbox/capture";
import { captureInboxItem } from "@/offline/commands";
import { useOffline } from "@/offline/provider";

/**
 * Quick Capture on Today. A capture writes a title-only Inbox Item to the local
 * replica and acknowledges immediately — well within the 100ms budget — then
 * lets the sync engine deliver it in the background. Classification happens
 * later in the Inbox, so nothing here blocks on the network or a decision.
 */
export function QuickCapture() {
  const { db, sync } = useOffline();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "") {
      return;
    }

    await captureInboxItem(db, trimmed);
    setTitle("");
    setConfirmed(true);
    inputRef.current?.focus();
    // Deliver in the background; the capture is already acknowledged locally.
    void sync();
  }

  return (
    <form
      aria-label="Quick capture"
      className="flex flex-col gap-2"
      onSubmit={onSubmit}
    >
      <label className="text-sm font-medium" htmlFor={inputId}>
        Quick capture
      </label>
      <div className="flex gap-2">
        <Input
          autoComplete="off"
          id={inputId}
          maxLength={INBOX_TITLE_MAX_LENGTH}
          name="title"
          onChange={(event) => {
            setTitle(event.target.value);
            if (confirmed) {
              setConfirmed(false);
            }
          }}
          placeholder="What's on your mind?"
          ref={inputRef}
          value={title}
        />
        <Button disabled={title.trim() === ""} type="submit">
          Capture
        </Button>
      </div>
      <p className="min-h-5 text-sm text-muted-foreground" role="status">
        {confirmed ? "Saved to Inbox." : ""}
      </p>
    </form>
  );
}
