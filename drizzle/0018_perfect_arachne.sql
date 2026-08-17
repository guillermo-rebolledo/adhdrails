-- migration-phase: expand
ALTER TABLE "user" ALTER COLUMN "timezone" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "timezone" DROP NOT NULL;--> statement-breakpoint
-- Backfill: every existing row reading 'UTC' got that value from the column
-- default, not from a user. There is no way to tell the two apart after the
-- fact -- that ambiguity is the bug this migration removes -- so they are reset
-- to unknown and re-learned from the browser on the account's next page load.
-- Self-correcting in both directions: an account genuinely on UTC has 'UTC'
-- written straight back, and no instant stored anywhere is touched.
UPDATE "user" SET "timezone" = NULL WHERE "timezone" = 'UTC';
