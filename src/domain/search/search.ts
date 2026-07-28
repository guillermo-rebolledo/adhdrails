import { z } from "zod";

export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_QUERY_MAX_LENGTH = 200;

export const searchResultTypeSchema = z.enum(["task", "thought", "inbox_item"]);
export type SearchResultType = z.infer<typeof searchResultTypeSchema>;

export const searchResultSchema = z.object({
  id: z.string().uuid(),
  type: searchResultTypeSchema,
  title: z.string(),
  excerpt: z.string(),
  href: z.string().startsWith("/"),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchPageSchema = z.object({
  items: z.array(searchResultSchema),
  nextCursor: z.string().nullable(),
});
export type SearchPage = z.infer<typeof searchPageSchema>;

export const searchQuerySchema = z.object({
  query: z.string().trim().min(1).max(SEARCH_QUERY_MAX_LENGTH),
  cursor: z.string().optional(),
});

export interface SearchCursor {
  score: number;
  type: SearchResultType;
  id: string;
}

export function encodeSearchCursor(cursor: SearchCursor): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeSearchCursor(
  value: string | undefined,
): SearchCursor | null {
  if (!value) return null;
  try {
    const unpadded = value.replaceAll("-", "+").replaceAll("_", "/");
    const base64 = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(base64)) as unknown;
    return z
      .object({
        score: z.number().finite(),
        type: searchResultTypeSchema,
        id: z.string().uuid(),
      })
      .parse(parsed);
  } catch {
    return null;
  }
}

export function resultHref(type: SearchResultType, id: string): string {
  switch (type) {
    case "task":
      return `/tasks/${id}/edit`;
    case "thought":
      return `/thoughts/${id}`;
    case "inbox_item":
      return `/inbox?item=${id}`;
  }
}
