import {
  decodeSearchCursor,
  encodeSearchCursor,
  resultHref,
  SEARCH_PAGE_SIZE,
  type SearchPage,
  type SearchResultType,
} from "@/domain/search/search";

import type { RailsDatabase } from "./db";

interface RankedLocalResult {
  id: string;
  type: SearchResultType;
  title: string;
  excerpt: string;
  score: number;
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  return new Set(
    Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) =>
      padded.slice(index, index + 3),
    ),
  );
}

function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function scoreContent(query: string, title: string, content: string): number {
  const normalizedTitle = normalize(title);
  const normalizedContent = normalize(content);
  const tokens = query.split(" ").filter(Boolean);
  const tokenCoverage =
    tokens.filter((token) => normalizedContent.includes(token)).length /
    tokens.length;
  const fuzzyCoverage =
    tokens.reduce((total, token) => {
      const words = normalizedContent.split(" ");
      return (
        total +
        Math.max(0, ...words.map((word) => trigramSimilarity(token, word)))
      );
    }, 0) / tokens.length;

  return (
    (normalizedTitle === query ? 4 : 0) +
    (normalizedTitle.startsWith(query) ? 2 : 0) +
    (normalizedTitle.includes(query) ? 1.5 : 0) +
    tokenCoverage * 2 +
    fuzzyCoverage
  );
}

function compareResults(left: RankedLocalResult, right: RankedLocalResult) {
  return (
    right.score - left.score ||
    left.type.localeCompare(right.type) ||
    left.id.localeCompare(right.id)
  );
}

function followsCursor(
  result: RankedLocalResult,
  cursor: ReturnType<typeof decodeSearchCursor>,
) {
  if (!cursor) return true;
  return (
    result.score < cursor.score ||
    (result.score === cursor.score &&
      (result.type > cursor.type ||
        (result.type === cursor.type && result.id > cursor.id)))
  );
}

/** Searches the durable account-local replica when the network is unavailable. */
export async function searchLocalContent(
  db: RailsDatabase,
  rawQuery: string,
  encodedCursor?: string | null,
  pageSize = SEARCH_PAGE_SIZE,
): Promise<SearchPage> {
  const query = normalize(rawQuery);
  if (!query) return { items: [], nextCursor: null };

  const [tasks, thoughts, inboxItems] = await Promise.all([
    db.tasks.filter((task) => task.deletedAt === null).toArray(),
    db.thoughts.filter((thought) => thought.deletedAt === null).toArray(),
    db.inboxItems
      .filter((item) => !item.deletedAt && !item.classifiedAt)
      .toArray(),
  ]);

  const candidates: RankedLocalResult[] = [
    ...tasks.map((task) => ({
      id: task.id,
      type: "task" as const,
      title: task.title,
      excerpt: task.notes,
      score: scoreContent(query, task.title, `${task.title} ${task.notes}`),
    })),
    ...thoughts.map((thought) => ({
      id: thought.id,
      type: "thought" as const,
      title: thought.title,
      excerpt: thought.body,
      score: scoreContent(
        query,
        thought.title,
        `${thought.title} ${thought.body}`,
      ),
    })),
    ...inboxItems.map((item) => ({
      id: item.id,
      type: "inbox_item" as const,
      title: item.title,
      excerpt: "",
      score: scoreContent(query, item.title, item.title),
    })),
  ]
    .filter((result) => result.score >= 0.55)
    .sort(compareResults);

  const cursor = decodeSearchCursor(encodedCursor ?? undefined);
  const page = candidates
    .filter((result) => followsCursor(result, cursor))
    .slice(0, pageSize + 1);
  const hasNextPage = page.length > pageSize;
  const visible = page.slice(0, pageSize);
  const last = visible.at(-1);

  return {
    items: visible.map((result) => ({
      id: result.id,
      type: result.type,
      title: result.title,
      excerpt: result.excerpt,
      href: resultHref(result.type, result.id),
    })),
    nextCursor:
      hasNextPage && last
        ? encodeSearchCursor({
            score: last.score,
            type: last.type,
            id: last.id,
          })
        : null,
  };
}
