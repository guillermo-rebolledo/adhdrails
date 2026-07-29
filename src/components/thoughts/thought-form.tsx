"use client";

import { type FormEvent, useEffect, useId, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { LightbulbIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  THOUGHT_BODY_MAX_LENGTH,
  THOUGHT_TITLE_MAX_LENGTH,
} from "@/domain/thought/thought";
import { useHydrated } from "@/hooks/use-hydrated";
import { createThought, updateThought } from "@/offline/commands";
import { useOffline } from "@/offline/provider";

function readDraft(key: string) {
  if (typeof window === "undefined") return { title: "", body: "" };
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as {
      title?: string;
      body?: string;
    };
  } catch {
    return { title: "", body: "" };
  }
}

export function ThoughtForm({ thoughtId }: { thoughtId?: string }) {
  const { accountId, db } = useOffline();
  const draftKey = `rails:thought-draft:${accountId}:${thoughtId ?? "new"}`;
  const draft = readDraft(draftKey);
  const existing = useLiveQuery(
    () => (thoughtId ? db.thoughts.get(thoughtId) : undefined),
    [db, thoughtId],
  );

  if (thoughtId && existing === undefined) return null;
  if (thoughtId && !existing) {
    return <p role="status">That Thought is not available on this device.</p>;
  }

  return (
    <ThoughtFormFields
      draftKey={draftKey}
      initialBody={draft.body ?? existing?.body ?? ""}
      initialTitle={draft.title ?? existing?.title ?? ""}
      thoughtId={thoughtId}
    />
  );
}

function ThoughtFormFields({
  draftKey,
  initialBody,
  initialTitle,
  thoughtId,
}: {
  draftKey: string;
  initialBody: string;
  initialTitle: string;
  thoughtId?: string;
}) {
  const { db, sync } = useOffline();
  const router = useRouter();
  const titleId = useId();
  const bodyId = useId();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  const hydrated = useHydrated();

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (title || body) {
        localStorage.setItem(draftKey, JSON.stringify({ title, body }));
      }
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [body, draftKey, title]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const thought = thoughtId
        ? await updateThought(db, thoughtId, { title, body })
        : await createThought(db, { title, body });
      localStorage.removeItem(draftKey);
      void sync();
      if (navigator.onLine) {
        router.push(`/thoughts/${thought.id}`);
      } else {
        setSavedOffline(true);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <LightbulbIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-medium">Reference, not a task</p>
          <p className="text-sm opacity-80">
            Thoughts keep useful ideas nearby without asking you to act on them.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={titleId}>
          Title
        </label>
        <Input
          autoFocus
          disabled={!hydrated}
          id={titleId}
          maxLength={THOUGHT_TITLE_MAX_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          value={title}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={bodyId}>
          Notes
        </label>
        <textarea
          className="min-h-48 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          disabled={!hydrated}
          id={bodyId}
          maxLength={THOUGHT_BODY_MAX_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add context you may want later…"
          value={body}
        />
      </div>
      <div className="flex justify-end">
        <Button
          disabled={!hydrated || !title.trim() || saving || savedOffline}
          type="submit"
        >
          {thoughtId ? "Save changes" : "Save Thought"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        This draft is saved on this device as you type.
      </p>
      <p className="min-h-5 text-sm text-muted-foreground" role="status">
        {savedOffline
          ? "Thought saved on this device. It will sync when you reconnect."
          : ""}
      </p>
    </form>
  );
}
