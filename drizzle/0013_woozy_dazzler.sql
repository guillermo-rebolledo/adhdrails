-- migration-phase: expand
CREATE TABLE "event_export_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"google_calendar_id" text,
	"google_event_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_export_job" ADD CONSTRAINT "event_export_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_export_job_identity_idx" ON "event_export_job" USING btree ("user_id","event_id","operation");--> statement-breakpoint
CREATE INDEX "event_export_job_status_created_idx" ON "event_export_job" USING btree ("status","created_at","id");