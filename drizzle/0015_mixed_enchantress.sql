-- migration-phase: expand
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "inbox_item_search_fts_idx" ON "inbox_item" USING gin (to_tsvector('simple', "title"));--> statement-breakpoint
CREATE INDEX "inbox_item_search_trgm_idx" ON "inbox_item" USING gin (lower("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "task_search_fts_idx" ON "task" USING gin (to_tsvector('simple', "title" || ' ' || "notes"));--> statement-breakpoint
CREATE INDEX "task_search_trgm_idx" ON "task" USING gin (lower("title" || ' ' || "notes") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "thought_search_fts_idx" ON "thought" USING gin (to_tsvector('simple', "title" || ' ' || "body"));--> statement-breakpoint
CREATE INDEX "thought_search_trgm_idx" ON "thought" USING gin (lower("title" || ' ' || "body") gin_trgm_ops);
