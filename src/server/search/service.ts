import type { SearchPage } from "@/domain/search/search";

import type { SearchRepository } from "./repository";

export interface SearchInput {
  query: string;
  cursor?: string;
}

/** Application use case for one account-scoped, ranked search page. */
export function createSearchService(repository: SearchRepository) {
  return {
    search(userId: string, input: SearchInput): Promise<SearchPage> {
      return repository.search(userId, input.query, input.cursor);
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
