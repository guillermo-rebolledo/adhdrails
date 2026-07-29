import { SearchView } from "@/components/search/search-view";

export default function SearchPage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Search</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Find what you remember
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-muted-foreground">
          Search your Tasks, Thoughts, and unprocessed Inbox Items—even when
          you’re offline.
        </p>
      </div>
      <SearchView />
    </section>
  );
}
