import type { ReactNode } from "react";
import Link from "next/link";

interface InfoPageProps {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}

export function InfoPage({ eyebrow, title, summary, children }: InfoPageProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-12 sm:px-8 sm:py-20">
      <Link
        className="mb-10 w-fit text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        href="/settings"
      >
        Back to Settings
      </Link>
      <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-pretty text-muted-foreground">{summary}</p>
      <div className="mt-10 flex flex-col gap-8 text-sm leading-6">
        {children}
      </div>
    </main>
  );
}
