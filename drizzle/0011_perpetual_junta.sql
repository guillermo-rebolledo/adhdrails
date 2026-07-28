-- migration-phase: expand
ALTER TABLE "calendar_selection" ADD COLUMN "sync_token" text;--> statement-breakpoint
ALTER TABLE "calendar_selection" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "event_account_google_identity_idx" ON "event" USING btree ("user_id","google_calendar_id","google_event_id");--> statement-breakpoint
DROP INDEX "event_google_identity_idx";
