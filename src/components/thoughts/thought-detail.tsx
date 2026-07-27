"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { LightbulbIcon } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deleteThoughtLocally,
  finalizeThoughtDeletion,
  restoreThought,
} from "@/offline/commands";
import { useOffline } from "@/offline/provider";

export function ThoughtDetail({ id }: { id: string }) {
  const { db, sync } = useOffline();
  const thought = useLiveQuery(() => db.thoughts.get(id), [db, id]);
  const [undoVisible, setUndoVisible] = useState(false);
  const pendingDeletion = useRef(false);

  useEffect(
    () => () => {
      if (pendingDeletion.current) {
        pendingDeletion.current = false;
        void finalizeThoughtDeletion(db, id).then(sync);
      }
    },
    [db, id, sync],
  );

  useEffect(() => {
    if (!undoVisible) return;
    const timeout = window.setTimeout(() => {
      pendingDeletion.current = false;
      setUndoVisible(false);
      void finalizeThoughtDeletion(db, id).then(sync);
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [db, id, sync, undoVisible]);

  if (thought === undefined) return null;
  if (!thought) {
    return <p role="status">That Thought is not available on this device.</p>;
  }
  if (thought.deletedAt) {
    return (
      <div className="rounded-xl border p-6" role="status">
        <p>Thought deleted. You can undo this for 10 seconds.</p>
        {undoVisible ? (
          <Button
            className="mt-4"
            onClick={async () => {
              pendingDeletion.current = false;
              await restoreThought(db, id);
              setUndoVisible(false);
            }}
            variant="outline"
          >
            Undo
          </Button>
        ) : (
          <Link
            className={cn(buttonVariants({ variant: "outline" }), "mt-4")}
            href="/thoughts"
          >
            Back to Thoughts
          </Link>
        )}
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <LightbulbIcon
          aria-hidden="true"
          className="mt-1 size-6 text-amber-600 dark:text-amber-400"
        />
        <div>
          <p className="text-sm text-muted-foreground">
            Non-actionable reference
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {thought.title}
          </h1>
        </div>
      </header>
      {thought.body ? (
        <p className="text-pretty whitespace-pre-wrap">{thought.body}</p>
      ) : (
        <p className="text-muted-foreground">No additional notes.</p>
      )}
      <div className="flex flex-wrap gap-2 border-t pt-5">
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={`/thoughts/${id}/edit`}
        >
          Edit
        </Link>
        <Button
          onClick={async () => {
            await deleteThoughtLocally(db, id);
            pendingDeletion.current = true;
            setUndoVisible(true);
          }}
          variant="destructive"
        >
          Delete Thought
        </Button>
      </div>
    </article>
  );
}
