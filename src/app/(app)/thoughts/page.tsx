import Link from "next/link";

import { ThoughtList } from "@/components/thoughts/thought-list";
import { buttonVariants } from "@/components/ui/button";

export default function ThoughtsPage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Thoughts</h1>
          <p className="mt-2 max-w-xl text-pretty text-muted-foreground">
            Lightweight references stay here without competing with what you
            need to do.
          </p>
        </div>
        <Link className={buttonVariants()} href="/thoughts/new">
          New Thought
        </Link>
      </div>
      <ThoughtList />
    </section>
  );
}
