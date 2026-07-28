import { sql } from "drizzle-orm";

import {
  decodeSearchCursor,
  encodeSearchCursor,
  resultHref,
  SEARCH_PAGE_SIZE,
  type SearchPage,
  type SearchResultType,
} from "@/domain/search/search";
import type { Database } from "@/server/db/connection";

interface SearchRow extends Record<string, unknown> {
  id: string;
  type: SearchResultType;
  title: string;
  excerpt: string;
  score: number;
}

/**
 * PostgreSQL's full-text rank handles multi-word intent while pg_trgm supplies
 * partial and typo-tolerant matches. Every UNION arm carries its own account
 * predicate so adding a new result kind cannot accidentally broaden tenancy.
 */
export function createSearchRepository(database: Database) {
  return {
    async search(
      userId: string,
      rawQuery: string,
      encodedCursor?: string,
      pageSize = SEARCH_PAGE_SIZE,
    ): Promise<SearchPage> {
      const query = rawQuery.trim();
      const cursor = decodeSearchCursor(encodedCursor);
      const cursorFilter = cursor
        ? sql`where (
            score < ${cursor.score}
            or (score = ${cursor.score} and type > ${cursor.type})
            or (score = ${cursor.score} and type = ${cursor.type} and id > ${cursor.id}::uuid)
          )`
        : sql``;

      const rows = await database.execute<SearchRow>(sql`
        with candidates as (
          select
            ${sql.raw(`'task'`)}::text as type,
            id,
            title,
            left(notes, 180) as excerpt,
            (
              ts_rank_cd(
                to_tsvector('simple', title || ' ' || notes),
                websearch_to_tsquery('simple', ${query})
              ) * 4
              + greatest(
                similarity(lower(title || ' ' || notes), lower(${query})),
                word_similarity(lower(${query}), lower(title || ' ' || notes))
              )
              + case when lower(title) like lower(${query}) || '%' then 1 else 0 end
              + case when lower(title || ' ' || notes) like '%' || lower(${query}) || '%' then 1 else 0 end
            )::double precision as score
          from task
          where user_id = ${userId}
            and (
              to_tsvector('simple', title || ' ' || notes) @@ websearch_to_tsquery('simple', ${query})
              or lower(title || ' ' || notes) like '%' || lower(${query}) || '%'
              or lower(${query}) <<% lower(title || ' ' || notes)
            )
          union all
          select
            ${sql.raw(`'thought'`)}::text,
            id,
            title,
            left(body, 180),
            (
              ts_rank_cd(
                to_tsvector('simple', title || ' ' || body),
                websearch_to_tsquery('simple', ${query})
              ) * 4
              + greatest(
                similarity(lower(title || ' ' || body), lower(${query})),
                word_similarity(lower(${query}), lower(title || ' ' || body))
              )
              + case when lower(title) like lower(${query}) || '%' then 1 else 0 end
              + case when lower(title || ' ' || body) like '%' || lower(${query}) || '%' then 1 else 0 end
            )::double precision
          from thought
          where user_id = ${userId}
            and deleted_at is null
            and (
              to_tsvector('simple', title || ' ' || body) @@ websearch_to_tsquery('simple', ${query})
              or lower(title || ' ' || body) like '%' || lower(${query}) || '%'
              or lower(${query}) <<% lower(title || ' ' || body)
            )
          union all
          select
            ${sql.raw(`'inbox_item'`)}::text,
            id,
            title,
            ${sql.raw(`''`)}::text,
            (
              ts_rank_cd(
                to_tsvector('simple', title),
                websearch_to_tsquery('simple', ${query})
              ) * 4
              + greatest(
                similarity(lower(title), lower(${query})),
                word_similarity(lower(${query}), lower(title))
              )
              + case when lower(title) like lower(${query}) || '%' then 1 else 0 end
              + case when lower(title) like '%' || lower(${query}) || '%' then 1 else 0 end
            )::double precision
          from inbox_item
          where user_id = ${userId}
            and classified_at is null
            and (
              to_tsvector('simple', title) @@ websearch_to_tsquery('simple', ${query})
              or lower(title) like '%' || lower(${query}) || '%'
              or lower(${query}) <<% lower(title)
            )
        )
        select id, type, title, excerpt, score
        from candidates
        ${cursorFilter}
        order by score desc, type asc, id asc
        limit ${pageSize + 1}
      `);

      const hasNextPage = rows.length > pageSize;
      const visible = rows.slice(0, pageSize);
      const last = visible.at(-1);

      return {
        items: visible.map((row) => ({
          id: row.id,
          type: row.type,
          title: row.title,
          excerpt: row.excerpt,
          href: resultHref(row.type, row.id),
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
    },
  };
}

export type SearchRepository = ReturnType<typeof createSearchRepository>;
