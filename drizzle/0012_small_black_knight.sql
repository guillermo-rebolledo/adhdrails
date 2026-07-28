-- migration-phase: expand
CREATE TABLE "calendar_sync_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"google_calendar_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_number" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_selection" ADD COLUMN "watch_channel_id" text;--> statement-breakpoint
ALTER TABLE "calendar_selection" ADD COLUMN "watch_resource_id" text;--> statement-breakpoint
ALTER TABLE "calendar_selection" ADD COLUMN "watch_token" text;--> statement-breakpoint
ALTER TABLE "calendar_selection" ADD COLUMN "watch_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_sync_job" ADD CONSTRAINT "calendar_sync_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_sync_job_delivery_idx" ON "calendar_sync_job" USING btree ("channel_id","message_number");--> statement-breakpoint
CREATE INDEX "calendar_sync_job_status_created_idx" ON "calendar_sync_job" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_selection_watch_channel_idx" ON "calendar_selection" USING btree ("watch_channel_id") WHERE watch_channel_id is not null;